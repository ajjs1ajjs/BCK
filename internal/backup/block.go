package backup

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"
)

type BlockSourceType string

const (
	BlockRawDevice  BlockSourceType = "raw_device"
	BlockLVMSnapshot BlockSourceType = "lvm_snapshot"
	BlockZFSSnapshot BlockSourceType = "zfs_snapshot"
	BlockVSSSnapshot BlockSourceType = "vss_snapshot" // Windows Volume Shadow Copy
)

type BlockBackupConfig struct {
	SourceType BlockSourceType
	DevicePath string
	BlockSize  int64 // default 64KB
	Offset     int64 // start reading from offset
	Limit      int64 // max bytes to read (0 = all)
}

type BlockReader struct {
	source    *os.File
	blockSize int64
	offset    int64
	limit     int64
	position  int64
}

func NewBlockReader(cfg *BlockBackupConfig) (*BlockReader, error) {
	if cfg.BlockSize <= 0 {
		cfg.BlockSize = 64 * 1024 // 64KB default
	}

	f, err := os.Open(cfg.DevicePath)
	if err != nil {
		return nil, fmt.Errorf("open device: %w", err)
	}

	if cfg.Offset > 0 {
		if _, err := f.Seek(cfg.Offset, io.SeekStart); err != nil {
			f.Close()
			return nil, fmt.Errorf("seek to offset: %w", err)
		}
	}

	return &BlockReader{
		source:    f,
		blockSize: cfg.BlockSize,
		offset:    cfg.Offset,
		limit:     cfg.Limit,
		position:  cfg.Offset,
	}, nil
}

func (br *BlockReader) Read(b []byte) (int, error) {
	if br.limit > 0 && br.position-br.offset >= br.limit {
		return 0, io.EOF
	}

	maxRead := int64(len(b))
	if br.limit > 0 {
		remaining := br.limit - (br.position - br.offset)
		if maxRead > remaining {
			maxRead = remaining
		}
	}

	n, err := br.source.Read(b[:maxRead])
	br.position += int64(n)
	return n, err
}

func (br *BlockReader) Close() error {
	return br.source.Close()
}

func (br *BlockReader) ReadBlock() ([]byte, int64, error) {
	buf := make([]byte, br.blockSize)
	n, err := io.ReadFull(br, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, 0, err
	}

	offset := br.position - int64(n)
	return buf[:n], offset, nil
}

type BlockBackup struct {
	logger   *zap.Logger
	chunker  *CDCChunker
	compressor *Compressor
	encryptor  *Encryptor
	repoPath   string
}

func NewBlockBackup(repoPath string, encryptionKey []byte, logger *zap.Logger) (*BlockBackup, error) {
	encryptor, err := NewEncryptor(encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("init encryptor: %w", err)
	}

	return &BlockBackup{
		logger:     logger,
		chunker:    NewCDCChunker(4 * 1024 * 1024),
		compressor: NewCompressor(3),
		encryptor:  encryptor,
		repoPath:   repoPath,
	}, nil
}

func (bb *BlockBackup) BackupDevice(ctx context.Context, cfg *BlockBackupConfig, progressCh chan<- BackupProgress) (*Snapshot, error) {
	reader, err := NewBlockReader(cfg)
	if err != nil {
		return nil, fmt.Errorf("create block reader: %w", err)
	}
	defer reader.Close()

	snapshot := &Snapshot{
		ID:        fmt.Sprintf("block-%s-%s", filepath.Base(cfg.DevicePath), TimestampFilename()),
		StartTime: time.Now(),
		Chunks:    make(map[string]*ChunkInfo),
		Tags:      []string{"block-level", string(cfg.SourceType)},
	}

	chunkDir := filepath.Join(bb.repoPath, "chunks")
	os.MkdirAll(chunkDir, 0700)
	os.MkdirAll(filepath.Join(bb.repoPath, "snapshots"), 0700)

	dedup := NewDedupStore()

	buf := make([]byte, bb.chunker.avgSize*4) // reading buffer
	var totalRead int64
	var chunkCount int64

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		n, err := reader.Read(buf)
		if n == 0 && err == io.EOF {
			break
		}
		if err != nil && err != io.EOF {
			bb.logger.Error("read block", zap.Error(err))
			break
		}

		totalRead += int64(n)
		data := buf[:n]

		chunks := bb.chunker.ChunkData(data)
		for _, chunk := range chunks {
			chunkID := chunk.ID()

			chunkInfo := &ChunkInfo{
				ID:   chunkID,
				Size: int64(len(chunk)),
				Hash: chunkID,
			}
			snapshot.Chunks[chunkID] = chunkInfo
			chunkCount++

			if !dedup.IsUnique(chunkID) {
				continue
			}

			compressed, _ := bb.compressor.Compress(chunk)
			encrypted, _ := bb.encryptor.Encrypt(compressed)

			chunkPath := filepath.Join(chunkDir, chunkID[:2], chunkID)
			os.MkdirAll(filepath.Dir(chunkPath), 0700)
			os.WriteFile(chunkPath, encrypted, 0600)
		}

		if err == io.EOF {
			break
		}
	}

	snapshot.TotalSize = totalRead
	snapshot.ChunkCount = chunkCount
	snapshot.EndTime = time.Now()

	progressCh <- BackupProgress{
		Phase:         "completed",
		BytesProcessed: totalRead,
		ChunksCreated:  chunkCount,
	}

	bb.logger.Info("block backup completed",
		zap.String("device", cfg.DevicePath),
		zap.Int64("bytes", totalRead),
		zap.Int64("chunks", chunkCount),
	)

	return snapshot, nil
}
