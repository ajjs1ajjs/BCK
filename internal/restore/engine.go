package restore

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/ajjs1ajjs/BCK/internal/backup"
	"go.uber.org/zap"
)

type Engine struct {
	repoPath   string
	compressor *backup.Compressor
	encryptor  *backup.Encryptor
	logger     *zap.Logger
}

func NewEngine(repoPath string, encryptionKey []byte, logger *zap.Logger) (*Engine, error) {
	encryptor, err := backup.NewEncryptor(encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("init encryptor: %w", err)
	}

	return &Engine{
		repoPath:   repoPath,
		compressor: backup.NewCompressor(3),
		encryptor:  encryptor,
		logger:     logger,
	}, nil
}

func (e *Engine) RestoreFile(snapshot *backup.Snapshot, fileEntry *backup.FileEntry, targetPath string) error {
	if fileEntry.IsDir {
		return os.MkdirAll(targetPath, os.FileMode(fileEntry.Mode))
	}

	if fileEntry.IsSymlink {
		return os.Symlink(fileEntry.SymlinkDest, targetPath)
	}

	if len(fileEntry.Chunks) == 0 {
		return fmt.Errorf("no chunks for file: %s", fileEntry.Path)
	}

	f, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	for _, chunkRef := range fileEntry.Chunks {
		data, err := e.loadAndDecryptChunk(chunkRef.ID)
		if err != nil {
			return fmt.Errorf("load chunk %s: %w", chunkRef.ID, err)
		}

		decompressed, err := e.compressor.Decompress(data)
		if err != nil {
			return fmt.Errorf("decompress chunk %s: %w", chunkRef.ID, err)
		}

		if _, err := f.Write(decompressed); err != nil {
			return fmt.Errorf("write chunk: %w", err)
		}
	}

	if err := os.Chmod(targetPath, os.FileMode(fileEntry.Mode)); err != nil {
		e.logger.Warn("failed to chmod", zap.String("path", targetPath), zap.Error(err))
	}

	return nil
}

func (e *Engine) loadAndDecryptChunk(chunkID string) ([]byte, error) {
	chunkPath := filepath.Join(e.repoPath, "chunks", chunkID[:2], chunkID)

	encrypted, err := os.ReadFile(chunkPath)
	if err != nil {
		return nil, fmt.Errorf("read chunk file: %w", err)
	}

	decrypted, err := e.encryptor.Decrypt(encrypted)
	if err != nil {
		return nil, fmt.Errorf("decrypt chunk: %w", err)
	}

	return decrypted, nil
}

func (e *Engine) GetChunkData(snapshotID string, chunkIDs []string) (map[string][]byte, error) {
	result := make(map[string][]byte, len(chunkIDs))

	for _, chunkID := range chunkIDs {
		data, err := e.loadAndDecryptChunk(chunkID)
		if err != nil {
			return result, err
		}
		result[chunkID] = data
	}

	return result, nil
}
