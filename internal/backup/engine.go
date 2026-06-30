package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

type Engine struct {
	options    *BackupOptions
	scanner    *Scanner
	chunker    *Chunker
	cdcChunker *CDCChunker
	dedup      *DedupStore
	compressor *Compressor
	encryptor  *Encryptor
	logger     *zap.Logger
}

func NewEngine(opts *BackupOptions, logger *zap.Logger) (*Engine, error) {
	encryptor, err := NewEncryptor(opts.EncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("init encryptor: %w", err)
	}

	return &Engine{
		options:    opts,
		scanner:    NewScanner(opts.ExcludePatterns),
		chunker:    NewChunker(opts.ChunkSize),
		cdcChunker: NewCDCChunker(opts.ChunkSize),
		dedup:      NewDedupStore(),
		compressor: NewCompressor(opts.CompressionLevel),
		encryptor:  encryptor,
		logger:     logger,
	}, nil
}

func (e *Engine) Run(ctx context.Context, progressCh chan<- BackupProgress) (*Snapshot, error) {
	snapshot := &Snapshot{
		ID:        TimestampFilename(),
		StartTime: time.Now(),
		Chunks:    make(map[string]*ChunkInfo),
	}

	chunkDir := filepath.Join(e.options.RepositoryPath, "chunks")
	chunkIndex := filepath.Join(e.options.RepositoryPath, "index")
	os.MkdirAll(chunkDir, 0700)
	os.MkdirAll(chunkIndex, 0700)

	// Phase 1: Scan
	progressCh <- BackupProgress{Phase: "scanning"}
	files, err := e.scanner.Scan(e.options.SourcePath)
	if err != nil {
		return nil, fmt.Errorf("scan failed: %w", err)
	}
	snapshot.Files = files
	snapshot.FileCount = int64(len(files))

	e.logger.Info("scan completed",
		zap.Int64("files", snapshot.FileCount),
		zap.String("path", e.options.SourcePath),
	)

	// Phase 2: Chunk, compress, encrypt, store
	progressCh <- BackupProgress{Phase: "processing", FilesTotal: int64(len(files))}

	var processed int64
	var totalBytes int64
	var uploadedBytes int64
	var mu sync.Mutex
	sem := make(chan struct{}, e.options.Concurrency)
	var wg sync.WaitGroup

	for _, file := range files {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		if file.IsDir || file.IsSymlink || file.Error != "" {
			atomic.AddInt64(&processed, 1)
			continue
		}

		sem <- struct{}{}
		wg.Add(1)

		go func(f *FileEntry) {
			defer wg.Done()
			defer func() { <-sem }()
			defer atomic.AddInt64(&processed, 1)

			fullPath := filepath.Join(e.options.SourcePath, filepath.FromSlash(f.Path))
			data, err := os.ReadFile(fullPath)
			if err != nil {
				f.Error = err.Error()
				return
			}

			chunks := e.chunker.ChunkData(data)
			for _, chunk := range chunks {
				compressed, err := e.compressor.Compress(chunk)
				if err != nil {
					f.Error = err.Error()
					return
				}

				encrypted, err := e.encryptor.Encrypt(compressed)
				if err != nil {
					f.Error = err.Error()
					return
				}

				chunkID := Chunk(encrypted).ID()
				chunkInfo := &ChunkInfo{
					ID:   chunkID,
					Size: int64(len(encrypted)),
					Hash: chunkID,
				}

				chunkPath := filepath.Join(chunkDir, chunkID[:2], chunkID)
				os.MkdirAll(filepath.Dir(chunkPath), 0700)
				if err := os.WriteFile(chunkPath, encrypted, 0600); err != nil {
					f.Error = err.Error()
					return
				}

				f.Chunks = append(f.Chunks, *chunkInfo)

				mu.Lock()
				snapshot.Chunks[chunkID] = chunkInfo
				snapshot.ChunkCount++
				uploaded := int64(len(encrypted))
				uploadedBytes += uploaded
				mu.Unlock()
			}

			atomic.AddInt64(&totalBytes, f.Size)

			progressCh <- BackupProgress{
				Phase:          "processing",
				FilesTotal:     int64(len(files)),
				FilesProcessed: atomic.LoadInt64(&processed),
				BytesProcessed: atomic.LoadInt64(&totalBytes),
				BytesUploaded:  atomic.LoadInt64(&uploadedBytes),
				ChunksCreated:  snapshot.ChunkCount,
			}
		}(file)
	}

	wg.Wait()

	snapshot.TotalSize = uploadedBytes
	snapshot.EndTime = time.Now()

	// Write snapshot file
	snapshotPath := filepath.Join(e.options.RepositoryPath, "snapshots", snapshot.ID+".json")
	os.MkdirAll(filepath.Dir(snapshotPath), 0700)

	snapData, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal snapshot: %w", err)
	}

	if err := os.WriteFile(snapshotPath, snapData, 0600); err != nil {
		return nil, fmt.Errorf("write snapshot: %w", err)
	}

	e.logger.Info("backup completed",
		zap.String("snapshot", snapshot.ID),
		zap.Int64("files", snapshot.FileCount),
		zap.Int64("chunks", snapshot.ChunkCount),
		zap.Int64("uploaded_bytes", uploadedBytes),
		zap.Duration("duration", snapshot.EndTime.Sub(snapshot.StartTime)),
	)

	progressCh <- BackupProgress{Phase: "completed"}

	return snapshot, nil
}

func (e *Engine) RunCDC(ctx context.Context, progressCh chan<- BackupProgress) (*Snapshot, error) {
	snapshot := &Snapshot{
		ID:        TimestampFilename(),
		StartTime: time.Now(),
		Chunks:    make(map[string]*ChunkInfo),
	}

	chunkDir := filepath.Join(e.options.RepositoryPath, "chunks")
	os.MkdirAll(chunkDir, 0700)
	os.MkdirAll(filepath.Join(e.options.RepositoryPath, "index"), 0700)

	progressCh <- BackupProgress{Phase: "scanning"}
	files, err := e.scanner.Scan(e.options.SourcePath)
	if err != nil {
		return nil, fmt.Errorf("scan failed: %w", err)
	}
	snapshot.Files = files
	snapshot.FileCount = int64(len(files))

	progressCh <- BackupProgress{Phase: "processing", FilesTotal: int64(len(files))}

	var processed int64
	var totalBytes int64
	var uploadedBytes int64
	var dedupeSaved int64
	var mu sync.Mutex
	sem := make(chan struct{}, e.options.Concurrency)
	var wg sync.WaitGroup

	for _, file := range files {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		if file.IsDir || file.IsSymlink || file.Error != "" {
			atomic.AddInt64(&processed, 1)
			continue
		}

		sem <- struct{}{}
		wg.Add(1)

		go func(f *FileEntry) {
			defer wg.Done()
			defer func() { <-sem }()
			defer atomic.AddInt64(&processed, 1)

			fullPath := filepath.Join(e.options.SourcePath, filepath.FromSlash(f.Path))
			data, err := os.ReadFile(fullPath)
			if err != nil {
				f.Error = err.Error()
				return
			}

			atomic.AddInt64(&totalBytes, f.Size)

			// Use CDC chunking
			chunks := e.cdcChunker.ChunkData(data)
			for _, chunk := range chunks {
				chunkID := chunk.ID()

				mu.Lock()
				isDupe := !e.dedup.IsUnique(chunkID)
				mu.Unlock()

				chunkInfo := &ChunkInfo{
					ID:   chunkID,
					Size: int64(len(chunk)),
					Hash: chunkID,
				}
				f.Chunks = append(f.Chunks, *chunkInfo)

				mu.Lock()
				snapshot.Chunks[chunkID] = chunkInfo
				snapshot.ChunkCount++
				mu.Unlock()

				if isDupe {
					dedupeSaved += int64(len(chunk))
					continue
				}

				compressed, err := e.compressor.Compress(chunk)
				if err != nil {
					f.Error = err.Error()
					return
				}

				encrypted, err := e.encryptor.Encrypt(compressed)
				if err != nil {
					f.Error = err.Error()
					return
				}

				chunkPath := filepath.Join(chunkDir, chunkID[:2], chunkID)
				os.MkdirAll(filepath.Dir(chunkPath), 0700)
				if err := os.WriteFile(chunkPath, encrypted, 0600); err != nil {
					f.Error = err.Error()
					return
				}

				atomic.AddInt64(&uploadedBytes, int64(len(encrypted)))
			}

			progressCh <- BackupProgress{
				Phase:           "processing",
				FilesTotal:      int64(len(files)),
				FilesProcessed:  atomic.LoadInt64(&processed),
				BytesProcessed:  atomic.LoadInt64(&totalBytes),
				BytesUploaded:   atomic.LoadInt64(&uploadedBytes),
				ChunksCreated:   atomic.LoadInt64(&snapshot.ChunkCount),
				CompressionRatio: float64(atomic.LoadInt64(&totalBytes)) / float64(atomic.LoadInt64(&uploadedBytes)+1),
			}
		}(file)
	}

	wg.Wait()

	snapshot.TotalSize = uploadedBytes
	snapshot.EndTime = time.Now()

	snapshotPath := filepath.Join(e.options.RepositoryPath, "snapshots", snapshot.ID+".json")
	os.MkdirAll(filepath.Dir(snapshotPath), 0700)

	snapData, _ := json.MarshalIndent(snapshot, "", "  ")
	os.WriteFile(snapshotPath, snapData, 0600)

	e.logger.Info("CDC backup completed",
		zap.String("snapshot", snapshot.ID),
		zap.Int64("files", snapshot.FileCount),
		zap.Int64("chunks", snapshot.ChunkCount),
		zap.Int64("uploaded_bytes", uploadedBytes),
		zap.Int64("dedupe_saved", dedupeSaved),
		zap.Duration("duration", snapshot.EndTime.Sub(snapshot.StartTime)),
	)

	progressCh <- BackupProgress{
		Phase:           "completed",
		CompressionRatio: float64(totalBytes) / float64(uploadedBytes+1),
	}

	return snapshot, nil
}
