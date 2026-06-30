package repository

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLocalRepo_Init(t *testing.T) {
	dir, err := os.MkdirTemp("", "bck-repo-test-*")
	if err != nil {
		t.Fatalf("create temp dir: %v", err)
	}
	defer os.RemoveAll(dir)

	repo := NewLocalRepo(dir)
	if err := repo.Init(); err != nil {
		t.Fatalf("init repo: %v", err)
	}

	// Verify directories exist
	for _, sub := range []string{"chunks", "snapshots", "index", "locks"} {
		path := filepath.Join(dir, sub)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("directory %s not created", sub)
		}
	}

	// Verify config exists
	cfgPath := filepath.Join(dir, "config.json")
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		t.Error("config.json not created")
	}
}

func TestLocalRepo_StoreAndLoadChunk(t *testing.T) {
	dir, err := os.MkdirTemp("", "bck-repo-test-*")
	if err != nil {
		t.Fatalf("create temp dir: %v", err)
	}
	defer os.RemoveAll(dir)

	repo := NewLocalRepo(dir)
	repo.Init()

	chunkID := "abcdef1234567890abcdef1234567890abcdef12"
	chunkData := []byte("test chunk data")

	if err := repo.StoreChunk(chunkID, chunkData); err != nil {
		t.Fatalf("store chunk: %v", err)
	}

	loaded, err := repo.LoadChunk(chunkID)
	if err != nil {
		t.Fatalf("load chunk: %v", err)
	}

	if string(loaded) != string(chunkData) {
		t.Errorf("chunk data mismatch: got %q, want %q", loaded, chunkData)
	}
}

func TestLocalRepo_DeleteChunk(t *testing.T) {
	dir, err := os.MkdirTemp("", "bck-repo-test-*")
	if err != nil {
		t.Fatalf("create temp dir: %v", err)
	}
	defer os.RemoveAll(dir)

	repo := NewLocalRepo(dir)
	repo.Init()

	chunkID := "abcdef1234567890abcdef1234567890abcdef12"
	repo.StoreChunk(chunkID, []byte("data"))

	if err := repo.DeleteChunk(chunkID); err != nil {
		t.Errorf("delete chunk: %v", err)
	}

	_, err = repo.LoadChunk(chunkID)
	if err == nil {
		t.Error("chunk should not exist after delete")
	}
}

func TestChunkIndex_AddRemove(t *testing.T) {
	dir, err := os.MkdirTemp("", "bck-chunkidx-test-*")
	if err != nil {
		t.Fatalf("create temp dir: %v", err)
	}
	defer os.RemoveAll(dir)

	ci := NewChunkIndex(dir)

	ci.Add("chunk-001", 1024, "snap-001")
	ci.Add("chunk-001", 1024, "snap-002")

	entry, ok := ci.Get("chunk-001")
	if !ok {
		t.Fatal("chunk not found in index")
	}

	if entry.RefCount != 2 {
		t.Errorf("expected ref count 2, got %d", entry.RefCount)
	}

	ci.Remove("chunk-001", "snap-001")

	entry, _ = ci.Get("chunk-001")
	if entry.RefCount != 1 {
		t.Errorf("expected ref count 1 after remove, got %d", entry.RefCount)
	}
}
