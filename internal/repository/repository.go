package repository

import (
	"github.com/ajjs1ajjs/BCK/internal/backup"
)

type RepoStats struct {
	TotalChunks   int64 `json:"total_chunks"`
	TotalSize     int64 `json:"total_size"`
	TotalSnapshots int64 `json:"total_snapshots"`
	DedupeSaved   int64 `json:"dedupe_saved"`
}

type Repository interface {
	Init() error
	StoreChunk(id string, data []byte) error
	LoadChunk(id string) ([]byte, error)
	DeleteChunk(id string) error
	ListChunks() ([]string, error)
	StoreSnapshot(snap *backup.Snapshot) error
	LoadSnapshot(id string) (*backup.Snapshot, error)
	ListSnapshots() ([]string, error)
	DeleteSnapshot(id string) error
	Stats() (*RepoStats, error)
}
