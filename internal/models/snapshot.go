package models

import (
	"encoding/json"
	"time"
)

type Snapshot struct {
	ID               string          `json:"id"`
	RepositoryID     string          `json:"repository_id"`
	JobID            *string         `json:"job_id,omitempty"`
	ParentSnapshotID *string         `json:"parent_snapshot_id,omitempty"`
	SnapshotPath     string          `json:"snapshot_path"`
	TotalSizeBytes   int64           `json:"total_size_bytes"`
	FileCount        int64           `json:"file_count"`
	ChunkCount       int64           `json:"chunk_count"`
	Tags             []string        `json:"tags,omitempty"`
	Metadata         json.RawMessage `json:"metadata,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
}

type SnapshotFile struct {
	Path        string      `json:"path"`
	Size        int64       `json:"size"`
	Mode        uint32      `json:"mode"`
	ModTime     time.Time   `json:"mod_time"`
	IsDir       bool        `json:"is_dir"`
	IsSymlink   bool        `json:"is_symlink"`
	SymlinkDest string      `json:"symlink_dest,omitempty"`
	Chunks      []ChunkRef  `json:"chunks,omitempty"`
	Children    []*SnapshotFile `json:"children,omitempty"`
}

type ChunkRef struct {
	ID   string `json:"id"`
	Size int64  `json:"size"`
}
