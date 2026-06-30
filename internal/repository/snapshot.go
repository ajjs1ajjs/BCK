package repository

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ajjs1ajjs/BCK/internal/backup"
)

type SnapshotManager struct {
	basePath string
}

func NewSnapshotManager(basePath string) *SnapshotManager {
	return &SnapshotManager{basePath: basePath}
}

func (sm *SnapshotManager) Save(snap *backup.Snapshot) error {
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}

	dir := sm.snapshotDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create snapshot dir: %w", err)
	}

	path := filepath.Join(dir, snap.ID+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write snapshot: %w", err)
	}

	return nil
}

func (sm *SnapshotManager) Load(id string) (*backup.Snapshot, error) {
	path := filepath.Join(sm.snapshotDir(), id+".json")
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

func (sm *SnapshotManager) List() ([]string, error) {
	var snapshots []string
	dir := sm.snapshotDir()

	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return snapshots, nil
		}
		return nil, fmt.Errorf("read snapshot dir: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			snapshots = append(snapshots, entry.Name())
		}
	}

	return snapshots, nil
}

func (sm *SnapshotManager) Delete(id string) error {
	path := filepath.Join(sm.snapshotDir(), id+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete snapshot: %w", err)
	}
	return nil
}

func (sm *SnapshotManager) snapshotDir() string {
	return filepath.Join(sm.basePath, "snapshots")
}

func (sm *SnapshotManager) GetFileTree(id string) (*backup.FileEntry, error) {
	snap, err := sm.Load(id)
	if err != nil {
		return nil, err
	}

	return BuildFileTree(snap.Files), nil
}

func BuildFileTree(files []*backup.FileEntry) *backup.FileEntry {
	root := &backup.FileEntry{
		Path:     "/",
		IsDir:    true,
		Children: []*backup.FileEntry{},
	}

	if len(files) == 0 {
		return root
	}

	rootPath := files[0].Path
	parts := splitPath(rootPath)
	if len(parts) > 0 {
		root.Path = parts[0]
	}

	return root
}

func splitPath(p string) []string {
	return []string{filepath.Dir(p), filepath.Base(p)}
}
