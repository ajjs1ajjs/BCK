package repository

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type ChunkIndex struct {
	Chunks map[string]*ChunkEntry `json:"chunks"`
	mu     sync.RWMutex
	path   string
}

type ChunkEntry struct {
	ID         string   `json:"id"`
	Size       int64    `json:"size"`
	RefCount   int      `json:"ref_count"`
	Snapshots  []string `json:"snapshots"`
}

func NewChunkIndex(basePath string) *ChunkIndex {
	path := filepath.Join(basePath, "index", "chunks.idx")
	index := &ChunkIndex{
		Chunks: make(map[string]*ChunkEntry),
		path:   path,
	}

	index.load()
	return index
}

func (ci *ChunkIndex) load() {
	ci.mu.Lock()
	defer ci.mu.Unlock()

	data, err := os.ReadFile(ci.path)
	if err != nil {
		return
	}

	json.Unmarshal(data, &ci.Chunks)
}

func (ci *ChunkIndex) save() error {
	dir := filepath.Dir(ci.path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create index dir: %w", err)
	}

	data, err := json.MarshalIndent(ci.Chunks, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal index: %w", err)
	}

	if err := os.WriteFile(ci.path, data, 0600); err != nil {
		return fmt.Errorf("write index: %w", err)
	}

	return nil
}

func (ci *ChunkIndex) Add(id string, size int64, snapshotID string) {
	ci.mu.Lock()
	defer ci.mu.Unlock()

	entry, exists := ci.Chunks[id]
	if !exists {
		entry = &ChunkEntry{
			ID:        id,
			Size:      size,
			RefCount:  0,
			Snapshots: []string{},
		}
		ci.Chunks[id] = entry
	}

	entry.RefCount++
	if !contains(entry.Snapshots, snapshotID) {
		entry.Snapshots = append(entry.Snapshots, snapshotID)
	}

	ci.save()
}

func (ci *ChunkIndex) Remove(id string, snapshotID string) {
	ci.mu.Lock()
	defer ci.mu.Unlock()

	entry, exists := ci.Chunks[id]
	if !exists {
		return
	}

	entry.RefCount--
	entry.Snapshots = removeStr(entry.Snapshots, snapshotID)

	if entry.RefCount <= 0 {
		delete(ci.Chunks, id)
	}

	ci.save()
}

func (ci *ChunkIndex) Get(id string) (*ChunkEntry, bool) {
	ci.mu.RLock()
	defer ci.mu.RUnlock()

	entry, ok := ci.Chunks[id]
	return entry, ok
}

func (ci *ChunkIndex) GetBySnapshot(snapshotID string) []string {
	ci.mu.RLock()
	defer ci.mu.RUnlock()

	var chunks []string
	for id, entry := range ci.Chunks {
		if contains(entry.Snapshots, snapshotID) {
			chunks = append(chunks, id)
		}
	}
	return chunks
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func removeStr(slice []string, item string) []string {
	result := make([]string, 0, len(slice))
	for _, s := range slice {
		if s != item {
			result = append(result, s)
		}
	}
	return result
}
