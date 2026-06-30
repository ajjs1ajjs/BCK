package backup

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"go.uber.org/zap"
)

type MigrationJob struct {
	ID            string    `json:"id"`
	SourceRepoID  string    `json:"source_repo_id"`
	TargetRepoID  string    `json:"target_repo_id"`
	Status        string    `json:"status"` // pending, running, completed, failed
	ChunksTotal   int64     `json:"chunks_total"`
	ChunksMigrated int64   `json:"chunks_migrated"`
	BytesMigrated int64    `json:"bytes_migrated"`
	StartedAt     time.Time `json:"started_at"`
	CompletedAt   time.Time `json:"completed_at,omitempty"`
	Error         string    `json:"error,omitempty"`
}

type MigrationProgress struct {
	JobID         string `json:"job_id"`
	PercentDone   float64 `json:"percent_done"`
	ChunksDone    int64  `json:"chunks_done"`
	BytesPerSec   float64 `json:"bytes_per_sec"`
	ETA           time.Duration `json:"eta"`
}

type MigrationManager struct {
	logger *zap.Logger
	jobs   map[string]*MigrationJob
	mu     sync.RWMutex
}

func NewMigrationManager(logger *zap.Logger) *MigrationManager {
	return &MigrationManager{
		logger: logger,
		jobs:   make(map[string]*MigrationJob),
	}
}

func (mm *MigrationManager) MigrateRepo(ctx context.Context, sourcePath, targetPath string, progressCh chan<- MigrationProgress) error {
	mm.logger.Info("starting cross-repo migration",
		zap.String("source", sourcePath),
		zap.String("target", targetPath),
	)

	chunkDir := filepath.Join(sourcePath, "chunks")
	snapshotDir := filepath.Join(sourcePath, "snapshots")

	targetChunks := filepath.Join(targetPath, "chunks")
	targetSnapshots := filepath.Join(targetPath, "snapshots")

	os.MkdirAll(targetChunks, 0700)
	os.MkdirAll(targetSnapshots, 0700)

	// Count chunks
	var chunkPaths []string
	filepath.Walk(chunkDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		chunkPaths = append(chunkPaths, path)
		return nil
	})

	total := int64(len(chunkPaths))
	var migrated int64
	var bytesMigrated int64
	var startTime = time.Now()

	for _, chunkPath := range chunkPaths {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		relPath, _ := filepath.Rel(chunkDir, chunkPath)
		targetPath := filepath.Join(targetChunks, relPath)

		os.MkdirAll(filepath.Dir(targetPath), 0700)

		if err := copyFile(chunkPath, targetPath); err != nil {
			mm.logger.Error("copy chunk failed",
				zap.String("chunk", relPath),
				zap.Error(err),
			)
			continue
		}

		info, _ := os.Stat(chunkPath)
		if info != nil {
			migrated++
			bytesMigrated += info.Size()
		}

		elapsed := time.Since(startTime).Seconds()
		progress := MigrationProgress{
			JobID:       "mig-" + filepath.Base(sourcePath),
			PercentDone: float64(migrated) / float64(total) * 100,
			ChunksDone:  migrated,
			BytesPerSec: float64(bytesMigrated) / elapsed,
		}
		if progress.BytesPerSec > 0 {
			remainingBytes := float64(total-migrated) * float64(bytesMigrated/migrated)
			progress.ETA = time.Duration(remainingBytes/progress.BytesPerSec) * time.Second
		}

		progressCh <- progress
	}

	// Copy snapshots
	entries, _ := os.ReadDir(snapshotDir)
	for _, entry := range entries {
		srcFile := filepath.Join(snapshotDir, entry.Name())
		dstFile := filepath.Join(targetSnapshots, entry.Name())
		copyFile(srcFile, dstFile)
	}

	progressCh <- MigrationProgress{
		JobID:       "mig-" + filepath.Base(sourcePath),
		PercentDone: 100,
		ChunksDone:  total,
	}

	mm.logger.Info("migration completed",
		zap.Int64("chunks", migrated),
		zap.Int64("bytes", bytesMigrated),
	)

	return nil
}

func (mm *MigrationManager) SyncRepo(ctx context.Context, sourcePath, targetPath string) error {
	targetChunks := filepath.Join(targetPath, "chunks")

	filepath.Walk(filepath.Join(sourcePath, "chunks"), func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		relPath, _ := filepath.Rel(filepath.Join(sourcePath, "chunks"), path)
		targetFile := filepath.Join(targetChunks, relPath)

		if _, err := os.Stat(targetFile); os.IsNotExist(err) {
			os.MkdirAll(filepath.Dir(targetFile), 0700)
			copyFile(path, targetFile)
		}

		return nil
	})

	return nil
}

func (mm *MigrationManager) EstimateMigration(sourcePath string) (int64, int64, error) {
	var totalSize int64
	var totalChunks int64

	chunkDir := filepath.Join(sourcePath, "chunks")
	filepath.Walk(chunkDir, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			totalSize += info.Size()
			totalChunks++
		}
		return nil
	})

	return totalChunks, totalSize, nil
}

func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("create dest: %w", err)
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return fmt.Errorf("copy: %w", err)
	}

	info, _ := sourceFile.Stat()
	if info != nil {
		os.Chmod(dst, info.Mode())
	}

	return nil
}
