package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"go.uber.org/zap"
)

type JournalEntry struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Operation string    `json:"operation"` // CREATE, MODIFY, DELETE, RENAME
	FilePath  string    `json:"file_path"`
	OldPath   string    `json:"old_path,omitempty"`
	Size      int64     `json:"size"`
	Checksum  string    `json:"checksum,omitempty"`
	Data      []byte    `json:"data,omitempty"`
	Applied   bool      `json:"applied"`
}

type CDPJournal struct {
	path      string
	entries   []JournalEntry
	mu        sync.RWMutex
	logger    *zap.Logger
	sequence  int64
}

func NewCDPJournal(path string, logger *zap.Logger) *CDPJournal {
	os.MkdirAll(filepath.Dir(path), 0700)
	j := &CDPJournal{
		path:   path,
		logger: logger,
	}
	j.load()
	return j
}

func (j *CDPJournal) Append(entry JournalEntry) error {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.sequence++
	entry.ID = fmt.Sprintf("%d-%d", time.Now().UnixNano(), j.sequence)
	entry.Timestamp = time.Now()
	j.entries = append(j.entries, entry)

	j.persist(entry)

	return nil
}

func (j *CDPJournal) persist(entry JournalEntry) {
	f, err := os.OpenFile(j.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		j.logger.Error("open journal", zap.Error(err))
		return
	}
	defer f.Close()

	data, _ := json.Marshal(entry)
	f.Write(append(data, '\n'))
}

func (j *CDPJournal) load() {
	f, err := os.Open(j.path)
	if err != nil {
		return
	}
	defer f.Close()

	decoder := json.NewDecoder(f)
	for decoder.More() {
		var entry JournalEntry
		if err := decoder.Decode(&entry); err == nil {
			j.entries = append(j.entries, entry)
		}
	}
}

func (j *CDPJournal) Replay(ctx context.Context, fromTime time.Time, targetDir string) error {
	j.mu.RLock()
	defer j.mu.RUnlock()

	j.logger.Info("replaying journal",
		zap.Time("from", fromTime),
		zap.String("target", targetDir),
		zap.Int("entries", len(j.entries)),
	)

	os.MkdirAll(targetDir, 0700)

	for _, entry := range j.entries {
		if entry.Timestamp.Before(fromTime) {
			continue
		}

		targetPath := filepath.Join(targetDir, entry.FilePath)

		switch entry.Operation {
		case "CREATE", "MODIFY":
			os.MkdirAll(filepath.Dir(targetPath), 0700)
			if len(entry.Data) > 0 {
				os.WriteFile(targetPath, entry.Data, 0644)
			} else {
				f, _ := os.Create(targetPath)
				if f != nil {
					f.Close()
				}
			}
		case "DELETE":
			os.Remove(targetPath)
		case "RENAME":
			oldPath := filepath.Join(targetDir, entry.OldPath)
			os.Rename(oldPath, targetPath)
		}
	}

	j.logger.Info("journal replay completed")
	return nil
}

func (j *CDPJournal) GetEntries(since time.Time) []JournalEntry {
	j.mu.RLock()
	defer j.mu.RUnlock()

	var result []JournalEntry
	for _, e := range j.entries {
		if e.Timestamp.After(since) {
			result = append(result, e)
		}
	}
	return result
}

func (j *CDPJournal) GetRecoveryPoints() []time.Time {
	j.mu.RLock()
	defer j.mu.RUnlock()

	seen := make(map[string]bool)
	var points []time.Time

	for _, e := range j.entries {
		key := e.Timestamp.Truncate(time.Second).Format(time.RFC3339)
		if !seen[key] {
			seen[key] = true
			points = append(points, e.Timestamp)
		}
	}
	return points
}

type FileWatcher struct {
	path      string
	journal   *CDPJournal
	compressor *Compressor
	logger    *zap.Logger
	stop      chan struct{}
}

func NewFileWatcher(watchPath, journalPath string, logger *zap.Logger) *FileWatcher {
	return &FileWatcher{
		path:       watchPath,
		journal:    NewCDPJournal(journalPath, logger),
		compressor: NewCompressor(1),
		logger:     logger,
		stop:       make(chan struct{}),
	}
}

func (fw *FileWatcher) Start(ctx context.Context, interval time.Duration) {
	fw.logger.Info("CDP file watcher started",
		zap.String("path", fw.path),
		zap.Duration("interval", interval),
	)

	// Snapshot current state
	snapshots := make(map[string]fileSnapshot)
	fw.scanState(fw.path, "", snapshots)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-fw.stop:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			fw.detectChanges(snapshots)
		}
	}
}

func (fw *FileWatcher) Stop() {
	close(fw.stop)
}

type fileSnapshot struct {
	Path     string
	Size     int64
	ModTime  time.Time
	Checksum string
	IsDir    bool
}

func (fw *FileWatcher) scanState(root, prefix string, snapshots map[string]fileSnapshot) {
	filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		relPath, _ := filepath.Rel(fw.path, path)
		if relPath == "." {
			return nil
		}

		snap := fileSnapshot{
			Path:    filepath.ToSlash(relPath),
			Size:    info.Size(),
			ModTime: info.ModTime(),
			IsDir:   info.IsDir(),
		}

		if !info.IsDir() {
			data, _ := os.ReadFile(path)
			h := sha256.Sum256(data)
			snap.Checksum = hex.EncodeToString(h[:])
		}

		snapshots[relPath] = snap
		return nil
	})
}

func (fw *FileWatcher) detectChanges(previous map[string]fileSnapshot) {
	current := make(map[string]fileSnapshot)
	fw.scanState(fw.path, "", current)

	// Detect creates and modifies
	for path, snap := range current {
		prev, exists := previous[path]
		if !exists {
			fw.logger.Info("CDP: file created", zap.String("path", path))
			data, _ := os.ReadFile(filepath.Join(fw.path, path))
			fw.journal.Append(JournalEntry{
				Operation: "CREATE",
				FilePath:  path,
				Size:      snap.Size,
				Checksum:  snap.Checksum,
				Data:      data,
			})
		} else if snap.Checksum != prev.Checksum || snap.ModTime != prev.ModTime {
			fw.logger.Info("CDP: file modified", zap.String("path", path))
			data, _ := os.ReadFile(filepath.Join(fw.path, path))
			fw.journal.Append(JournalEntry{
				Operation: "MODIFY",
				FilePath:  path,
				Size:      snap.Size,
				Checksum:  snap.Checksum,
				Data:      data,
			})
		}
	}

	// Detect deletes
	for path := range previous {
		if _, exists := current[path]; !exists {
			fw.logger.Info("CDP: file deleted", zap.String("path", path))
			fw.journal.Append(JournalEntry{
				Operation: "DELETE",
				FilePath:  path,
			})
		}
	}

	// Update reference
	for k, v := range current {
		previous[k] = v
	}
}

func (fw *FileWatcher) RecoverTo(ctx context.Context, timestamp time.Time, targetDir string) error {
	return fw.journal.Replay(ctx, timestamp, targetDir)
}
