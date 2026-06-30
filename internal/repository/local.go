package repository

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ajjs1ajjs/BCK/internal/backup"
)

type LocalRepo struct {
	basePath string
}

type repoConfig struct {
	Version     int    `json:"version"`
	Compression string `json:"compression"`
	Encrypted   bool   `json:"encrypted"`
}

func NewLocalRepo(basePath string) *LocalRepo {
	return &LocalRepo{basePath: basePath}
}

func (r *LocalRepo) Init() error {
	dirs := []string{
		r.basePath,
		r.chunkDir(),
		r.snapshotDir(),
		r.indexDir(),
		r.locksDir(),
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return fmt.Errorf("create dir %s: %w", dir, err)
		}
	}

	cfg := repoConfig{
		Version:     1,
		Compression: "zstd",
		Encrypted:   true,
	}

	cfgPath := filepath.Join(r.basePath, "config.json")
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		data, err := json.MarshalIndent(cfg, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal config: %w", err)
		}
		if err := os.WriteFile(cfgPath, data, 0600); err != nil {
			return fmt.Errorf("write config: %w", err)
		}
	}

	return nil
}

func (r *LocalRepo) StoreChunk(id string, data []byte) error {
	chunkPath := r.chunkPath(id)

	if err := os.MkdirAll(filepath.Dir(chunkPath), 0700); err != nil {
		return fmt.Errorf("create chunk dir: %w", err)
	}

	if err := os.WriteFile(chunkPath, data, 0600); err != nil {
		return fmt.Errorf("write chunk: %w", err)
	}

	return nil
}

func (r *LocalRepo) LoadChunk(id string) ([]byte, error) {
	return os.ReadFile(r.chunkPath(id))
}

func (r *LocalRepo) DeleteChunk(id string) error {
	path := r.chunkPath(id)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete chunk: %w", err)
	}
	return nil
}

func (r *LocalRepo) ListChunks() ([]string, error) {
	var chunks []string
	err := filepath.Walk(r.chunkDir(), func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			relPath, _ := filepath.Rel(r.chunkDir(), path)
			chunks = append(chunks, strings.ReplaceAll(relPath, string(os.PathSeparator), ""))
		}
		return nil
	})
	return chunks, err
}

func (r *LocalRepo) StoreSnapshot(snap *backup.Snapshot) error {
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}

	path := filepath.Join(r.snapshotDir(), snap.ID+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write snapshot: %w", err)
	}

	return nil
}

func (r *LocalRepo) LoadSnapshot(id string) (*backup.Snapshot, error) {
	path := filepath.Join(r.snapshotDir(), id+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read snapshot: %w", err)
	}

	var snap backup.Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, fmt.Errorf("unmarshal snapshot: %w", err)
	}

	return &snap, nil
}

func (r *LocalRepo) ListSnapshots() ([]string, error) {
	var snapshots []string
	entries, err := os.ReadDir(r.snapshotDir())
	if err != nil {
		if os.IsNotExist(err) {
			return snapshots, nil
		}
		return nil, err
	}

	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			snapshots = append(snapshots, strings.TrimSuffix(entry.Name(), ".json"))
		}
	}

	return snapshots, nil
}

func (r *LocalRepo) DeleteSnapshot(id string) error {
	path := filepath.Join(r.snapshotDir(), id+".json")
	return os.Remove(path)
}

func (r *LocalRepo) Stats() (*RepoStats, error) {
	stats := &RepoStats{}

	snapshots, _ := r.ListSnapshots()
	stats.TotalSnapshots = int64(len(snapshots))

	chunks, err := r.ListChunks()
	if err != nil {
		return stats, err
	}
	stats.TotalChunks = int64(len(chunks))

	var totalSize int64
	for _, chunkID := range chunks {
		path := r.chunkPath(chunkID)
		info, err := os.Stat(path)
		if err == nil {
			totalSize += info.Size()
		}
	}
	stats.TotalSize = totalSize

	return stats, nil
}

func (r *LocalRepo) chunkDir() string {
	return filepath.Join(r.basePath, "chunks")
}

func (r *LocalRepo) snapshotDir() string {
	return filepath.Join(r.basePath, "snapshots")
}

func (r *LocalRepo) indexDir() string {
	return filepath.Join(r.basePath, "index")
}

func (r *LocalRepo) locksDir() string {
	return filepath.Join(r.basePath, "locks")
}

func (r *LocalRepo) chunkPath(id string) string {
	if len(id) < 4 {
		return filepath.Join(r.chunkDir(), id)
	}
	return filepath.Join(r.chunkDir(), id[:2], id)
}
