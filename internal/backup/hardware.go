package backup

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"
)

type TapeLibrary struct {
	Name     string   `json:"name"`
	Device   string   `json:"device"`   // /dev/nst0, /dev/tape
	Slots    int      `json:"slots"`
	Barcode  string   `json:"barcode,omitempty"`
	Tapes    []Tape   `json:"tapes"`
	Status   string   `json:"status"` // ready, empty, error
}

type Tape struct {
	ID         string    `json:"id"`
	Barcode    string    `json:"barcode"`
	CapacityGB int64     `json:"capacity_gb"`
	UsedGB     int64     `json:"used_gb"`
	WriteCount int       `json:"write_count"`
	LastUsed   time.Time `json:"last_used"`
	Status     string    `json:"status"` // writable, full, readonly, error
	Location   string    `json:"location"` // slot number or "vault"
}

type TapeBackup struct {
	ID          string    `json:"id"`
	TapeID      string    `json:"tape_id"`
	SnapshotIDs []string  `json:"snapshot_ids"`
	SizeBytes   int64     `json:"size_bytes"`
	StartedAt   time.Time `json:"started_at"`
	CompletedAt time.Time `json:"completed_at"`
	Checksum    string    `json:"checksum"`
}

type HSMManager struct {
	tapes       map[string]*Tape
	libraries   map[string]*TapeLibrary
	stagingDir  string
	cacheDir    string
	logger      *zap.Logger
}

func NewHSMManager(stagingDir, cacheDir string, logger *zap.Logger) *HSMManager {
	os.MkdirAll(stagingDir, 0700)
	os.MkdirAll(cacheDir, 0700)

	return &HSMManager{
		tapes:     make(map[string]*Tape),
		libraries: make(map[string]*TapeLibrary),
		stagingDir: stagingDir,
		cacheDir:  cacheDir,
		logger:    logger,
	}
}

func (hm *HSMManager) RegisterLibrary(lib *TapeLibrary) {
	hm.libraries[lib.Name] = lib
	hm.logger.Info("tape library registered",
		zap.String("name", lib.Name),
		zap.Int("slots", lib.Slots),
	)
}

func (hm *HSMManager) AddTape(tape *Tape) {
	hm.tapes[tape.ID] = tape
}

func (hm *HSMManager) WriteToTape(ctx context.Context, tapeID string, data []byte, snapshotID string) error {
	tape, exists := hm.tapes[tapeID]
	if !exists {
		return fmt.Errorf("tape not found: %s", tapeID)
	}

	if tape.Status == "full" || tape.Status == "readonly" {
		return fmt.Errorf("tape %s is %s", tapeID, tape.Status)
	}

	chunkSize := 256 * 1024 * 1024 // 256MB blocks
	offset := tape.UsedGB * 1024 * 1024 * 1024

	tapePath := filepath.Join(hm.stagingDir, tape.Barcode+".tape")

	f, err := os.OpenFile(tapePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("open tape file: %w", err)
	}
	defer f.Close()

	// Write in blocks
	for i := 0; i < len(data); i += chunkSize {
		end := i + chunkSize
		if end > len(data) {
			end = len(data)
		}

		if _, err := f.Write(data[i:end]); err != nil {
			return fmt.Errorf("write block at offset %d: %w", offset+int64(i), err)
		}
	}

	tape.UsedGB += int64(len(data)) / (1024 * 1024 * 1024)
	tape.WriteCount++
	tape.LastUsed = time.Now()

	if tape.UsedGB >= tape.CapacityGB {
		tape.Status = "full"
	}

	hm.logger.Info("data written to tape",
		zap.String("tape", tapeID),
		zap.Int("size_bytes", len(data)),
	)

	return nil
}

func (hm *HSMManager) ReadFromTape(ctx context.Context, tapeID string, offsetGB, sizeGB int64) ([]byte, error) {
	tape, exists := hm.tapes[tapeID]
	if !exists {
		return nil, fmt.Errorf("tape not found: %s", tapeID)
	}

	tapePath := filepath.Join(hm.stagingDir, tape.Barcode+".tape")
	data, err := os.ReadFile(tapePath)
	if err != nil {
		return nil, fmt.Errorf("read tape: %w", err)
	}

	offset := offsetGB * 1024 * 1024 * 1024
	end := offset + sizeGB*1024*1024*1024
	if end > int64(len(data)) {
		end = int64(len(data))
	}

	return data[offset:end], nil
}

func (hm *HSMManager) EjectTape(tapeID string) error {
	tape, exists := hm.tapes[tapeID]
	if !exists {
		return fmt.Errorf("tape not found: %s", tapeID)
	}
	tape.Location = "vault"
	hm.logger.Info("tape ejected to vault", zap.String("tape", tapeID))
	return nil
}

func (hm *HSMManager) LoadTape(tapeID string) error {
	tape, exists := hm.tapes[tapeID]
	if !exists {
		return fmt.Errorf("tape not found: %s", tapeID)
	}
	tape.Location = "drive"
	hm.logger.Info("tape loaded into drive", zap.String("tape", tapeID))
	return nil
}

type SSDCache struct {
	path       string
	maxSizeGB  int64
	usedGB     int64
	logger     *zap.Logger
}

func NewSSDCache(path string, maxSizeGB int64, logger *zap.Logger) *SSDCache {
	os.MkdirAll(path, 0700)
	return &SSDCache{
		path:      path,
		maxSizeGB: maxSizeGB,
		logger:    logger,
	}
}

func (sc *SSDCache) CacheChunk(chunkID string, data []byte) error {
	cachePath := filepath.Join(sc.path, chunkID[:2], chunkID)
	os.MkdirAll(filepath.Dir(cachePath), 0700)
	return os.WriteFile(cachePath, data, 0600)
}

func (sc *SSDCache) GetChunk(chunkID string) ([]byte, error) {
	cachePath := filepath.Join(sc.path, chunkID[:2], chunkID)
	return os.ReadFile(cachePath)
}

func (sc *SSDCache) Evict() {
	entries, _ := os.ReadDir(sc.path)
	if len(entries) > 10000 {
		// Simple FIFO eviction
		for _, e := range entries[:1000] {
			os.RemoveAll(filepath.Join(sc.path, e.Name()))
		}
	}
}

func (hm *HSMManager) ArchiveToTape(ctx context.Context, snapshotIDs []string) error {
	for _, sid := range snapshotIDs {
		hm.logger.Info("archiving snapshot to tape", zap.String("snapshot", sid))

		for _, tape := range hm.tapes {
			if tape.Status == "writable" {
				hm.WriteToTape(ctx, tape.ID, []byte(fmt.Sprintf("archive:%s", sid)), sid)
				break
			}
		}
	}
	return nil
}
