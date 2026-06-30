package restore

import (
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/ajjs1ajjs/BCK/internal/backup"
	"go.uber.org/zap"
)

type FullRestorer struct {
	engine *Engine
	logger *zap.Logger
}

type RestoreProgress struct {
	Phase          string `json:"phase"`
	FilesTotal     int64  `json:"files_total"`
	FilesRestored  int64  `json:"files_restored"`
	BytesRestored  int64  `json:"bytes_restored"`
	BytesTotal     int64  `json:"bytes_total"`
}

func NewFullRestorer(engine *Engine, logger *zap.Logger) *FullRestorer {
	return &FullRestorer{
		engine: engine,
		logger: logger,
	}
}

func (fr *FullRestorer) RestoreFull(snapshot *backup.Snapshot, targetDir string, progressCh chan<- RestoreProgress) error {
	if err := os.MkdirAll(targetDir, 0700); err != nil {
		return fmt.Errorf("create target dir: %w", err)
	}

	var restored int64
	var bytesRestored int64

	progressCh <- RestoreProgress{
		Phase:      "restoring",
		FilesTotal: snapshot.FileCount,
	}

	for _, entry := range snapshot.Files {
		targetPath := filepath.Join(targetDir, filepath.FromSlash(entry.Path))

		if entry.IsDir {
			if err := os.MkdirAll(targetPath, os.FileMode(entry.Mode)); err != nil {
				fr.logger.Error("create dir", zap.String("path", targetPath), zap.Error(err))
			}
			atomic.AddInt64(&restored, 1)
			continue
		}

		if entry.IsSymlink {
			if err := os.Symlink(entry.SymlinkDest, targetPath); err != nil {
				fr.logger.Error("create symlink", zap.String("path", targetPath), zap.Error(err))
			}
			atomic.AddInt64(&restored, 1)
			continue
		}

		if entry.Error != "" {
			fr.logger.Warn("skipping file with error",
				zap.String("path", entry.Path),
				zap.String("error", entry.Error),
			)
			atomic.AddInt64(&restored, 1)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(targetPath), 0700); err != nil {
			return fmt.Errorf("create parent dir: %w", err)
		}

		if err := fr.engine.RestoreFile(snapshot, entry, targetPath); err != nil {
			return fmt.Errorf("restore file %s: %w", entry.Path, err)
		}

		atomic.AddInt64(&restored, 1)
		atomic.AddInt64(&bytesRestored, entry.Size)

		progressCh <- RestoreProgress{
			Phase:         "restoring",
			FilesTotal:    snapshot.FileCount,
			FilesRestored: atomic.LoadInt64(&restored),
			BytesRestored: atomic.LoadInt64(&bytesRestored),
			BytesTotal:    snapshot.TotalSize,
		}
	}

	progressCh <- RestoreProgress{
		Phase:      "completed",
		FilesTotal: snapshot.FileCount,
		BytesTotal: snapshot.TotalSize,
	}

	fr.logger.Info("full restore completed",
		zap.Int64("files", restored),
		zap.Int64("bytes", bytesRestored),
	)

	return nil
}
