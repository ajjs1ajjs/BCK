package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/ajjs1ajjs/BCK/internal/backup"
	"github.com/ajjs1ajjs/BCK/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Worker struct {
	db     *pgxpool.Pool
	redis  *redis.Client
	cfg    *config.Config
	logger *zap.Logger
	id     int
}

func New(id int, db *pgxpool.Pool, redis *redis.Client, cfg *config.Config, logger *zap.Logger) *Worker {
	return &Worker{
		id:     id,
		db:     db,
		redis:  redis,
		cfg:    cfg,
		logger: logger.With(zap.Int("worker_id", id)),
	}
}

func (w *Worker) Run(ctx context.Context) {
	w.logger.Info("worker started")

	for {
		select {
		case <-ctx.Done():
			w.logger.Info("worker stopped")
			return
		default:
		}

		result, err := w.redis.BRPop(ctx, 5*time.Second, "bck:queue:jobs").Result()
		if err != nil {
			if err == redis.Nil {
				continue
			}
			w.logger.Error("brpop error", zap.Error(err))
			time.Sleep(time.Second)
			continue
		}

		if len(result) < 2 {
			continue
		}

		jobID := result[1]
		w.logger.Info("processing job", zap.String("job_id", jobID))
		w.processJob(ctx, jobID)
	}
}

func (w *Worker) processJob(ctx context.Context, jobID string) {
	// Get job details
	var sourcePath, repoID, name string
	var chunkSizeBytes int64
	var compressionLevel int
	var maxRetries int
	err := w.db.QueryRow(ctx,
		`SELECT name, source_path, repository_id, chunk_size_bytes, compression_level, max_retries
		 FROM backup_jobs WHERE id = $1`, jobID,
	).Scan(&name, &sourcePath, &repoID, &chunkSizeBytes, &compressionLevel, &maxRetries)
	if err != nil {
		w.logger.Error("get job details", zap.String("job_id", jobID), zap.Error(err))
		return
	}

	// Get repository path
	var storageConfig []byte
	var repoStatus string
	err = w.db.QueryRow(ctx,
		`SELECT storage_config, status FROM repositories WHERE id = $1`, repoID,
	).Scan(&storageConfig, &repoStatus)
	if err != nil {
		w.logger.Error("get repo details", zap.String("repo_id", repoID), zap.Error(err))
		return
	}

	repoPath := w.cfg.Storage.Local.Path
	if repoPath == "" {
		repoPath = "./repos"
	}
	repoPath = fmt.Sprintf("%s/%s", repoPath, repoID)

	w.logger.Info("job details",
		zap.String("name", name),
		zap.String("source", sourcePath),
		zap.String("repo_path", repoPath),
		zap.Int64("chunk_size", chunkSizeBytes),
	)

	// Find latest pending run
	var runID string
	err = w.db.QueryRow(ctx,
		`SELECT id FROM job_runs WHERE job_id = $1 AND status = 'pending'
		 ORDER BY created_at DESC LIMIT 1`, jobID,
	).Scan(&runID)
	if err != nil {
		w.logger.Error("find run", zap.Error(err))
		return
	}

	// Mark run as running
	now := time.Now()
	w.db.Exec(ctx,
		`UPDATE job_runs SET status = 'running', started_at = $2 WHERE id = $1`,
		runID, now,
	)

	// Execute backup
	opts := &backup.BackupOptions{
		SourcePath:       sourcePath,
		RepositoryPath:   repoPath,
		ChunkSize:        chunkSizeBytes,
		CompressionLevel: compressionLevel,
		Concurrency:      4,
		EncryptionKey:    []byte("default-key-change-in-production"),
	}

	engine, err := backup.NewEngine(opts, w.logger)
	if err != nil {
		w.failRun(ctx, runID, err)
		return
	}

	progressCh := make(chan backup.BackupProgress, 100)
	go func() {
		for p := range progressCh {
			w.logger.Info("progress",
				zap.String("phase", p.Phase),
				zap.Int64("files_processed", p.FilesProcessed),
				zap.Int64("bytes_processed", p.BytesProcessed),
			)
		}
	}()

	snapshot, err := engine.Run(ctx, progressCh)
	close(progressCh)

	if err != nil {
		w.failRun(ctx, runID, err)
		return
	}

	// Mark run as success
	duration := time.Since(now).Seconds()
	w.db.Exec(ctx,
		`UPDATE job_runs SET
			status = 'success',
			finished_at = NOW(),
			duration_seconds = $2,
			bytes_processed = $3,
			bytes_uploaded = $4,
			files_processed = $5,
			snapshot_id = $6
		 WHERE id = $1`,
		runID, duration,
		snapshot.TotalSize, snapshot.TotalSize,
		snapshot.FileCount, snapshot.ID,
	)

	w.logger.Info("job completed",
		zap.String("job_id", jobID),
		zap.String("snapshot_id", snapshot.ID),
		zap.Duration("duration", time.Duration(duration)*time.Second),
	)
}

func (w *Worker) failRun(ctx context.Context, runID string, err error) {
	w.logger.Error("job failed", zap.String("run_id", runID), zap.Error(err))
	w.db.Exec(ctx,
		`UPDATE job_runs SET
			status = 'failed',
			finished_at = NOW(),
			error_message = $2
		 WHERE id = $1`,
		runID, err.Error(),
	)
}
