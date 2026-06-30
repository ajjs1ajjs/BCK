package restore

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/ajjs1ajjs/BCK/internal/backup"
	"go.uber.org/zap"
)

type FileRestorer struct {
	engine *Engine
	logger *zap.Logger
}

func NewFileRestorer(engine *Engine, logger *zap.Logger) *FileRestorer {
	return &FileRestorer{
		engine: engine,
		logger: logger,
	}
}

func (fr *FileRestorer) RestoreFiles(snapshot *backup.Snapshot, filePaths []string, targetDir string) error {
	if err := os.MkdirAll(targetDir, 0700); err != nil {
		return fmt.Errorf("create target dir: %w", err)
	}

	fileSet := make(map[string]bool)
	for _, fp := range filePaths {
		fileSet[fp] = true
	}

	for _, entry := range snapshot.Files {
		if !fileSet[entry.Path] {
			continue
		}

		targetPath := filepath.Join(targetDir, filepath.FromSlash(entry.Path))

		if err := os.MkdirAll(filepath.Dir(targetPath), 0700); err != nil {
			return fmt.Errorf("create parent dir: %w", err)
		}

		if entry.IsDir {
			if err := os.MkdirAll(targetPath, os.FileMode(entry.Mode)); err != nil {
				fr.logger.Error("create dir", zap.String("path", targetPath), zap.Error(err))
			}
			continue
		}

		if entry.Error != "" {
			fr.logger.Warn("skipping file with error",
				zap.String("path", entry.Path),
				zap.String("error", entry.Error),
			)
			continue
		}

		if err := fr.engine.RestoreFile(snapshot, entry, targetPath); err != nil {
			return fmt.Errorf("restore file %s: %w", entry.Path, err)
		}

		fr.logger.Info("restored file",
			zap.String("path", entry.Path),
			zap.Int64("size", entry.Size),
		)
	}

	return nil
}
