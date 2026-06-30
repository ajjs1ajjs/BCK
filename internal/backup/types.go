package backup

import (
	"time"
)

type FileEntry struct {
	Path        string       `json:"path"`
	Size        int64        `json:"size"`
	Mode        uint32       `json:"mode"`
	ModTime     time.Time    `json:"mod_time"`
	IsDir       bool         `json:"is_dir"`
	IsSymlink   bool         `json:"is_symlink"`
	SymlinkDest string       `json:"symlink_dest,omitempty"`
	Checksum    string       `json:"checksum,omitempty"`
	Chunks      []ChunkInfo  `json:"chunks,omitempty"`
	Children    []*FileEntry `json:"children,omitempty"`
	Error       string       `json:"error,omitempty"`
}

type ChunkInfo struct {
	ID   string `json:"id"`
	Size int64  `json:"size"`
	Hash string `json:"hash"`
}

type Snapshot struct {
	ID               string                `json:"id"`
	ParentSnapshotID string                `json:"parent_snapshot_id,omitempty"`
	StartTime        time.Time             `json:"start_time"`
	EndTime          time.Time             `json:"end_time"`
	TotalSize        int64                 `json:"total_size"`
	FileCount        int64                 `json:"file_count"`
	ChunkCount       int64                 `json:"chunk_count"`
	Files            []*FileEntry          `json:"files"`
	Chunks           map[string]*ChunkInfo `json:"chunks"`
	Tags             []string              `json:"tags,omitempty"`
}

type BackupOptions struct {
	SourcePath       string
	RepositoryPath   string
	ExcludePatterns  []string
	ChunkSize        int64
	CompressionLevel int
	EncryptionKey    []byte
	Concurrency      int
}

type BackupProgress struct {
	Phase           string `json:"phase"`
	FilesTotal      int64  `json:"files_total"`
	FilesProcessed  int64  `json:"files_processed"`
	BytesTotal      int64  `json:"bytes_total"`
	BytesProcessed  int64  `json:"bytes_processed"`
	ChunksCreated   int64  `json:"chunks_created"`
	BytesUploaded   int64  `json:"bytes_uploaded"`
	CompressionRatio float64 `json:"compression_ratio"`
}
