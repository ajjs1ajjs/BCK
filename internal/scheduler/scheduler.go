package scheduler

import (
	"context"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/robfig/cron/v3"
	"go.uber.org/zap"
)

type Scheduler struct {
	db     *pgxpool.Pool
	redis  *redis.Client
	cron   *cron.Cron
	logger *zap.Logger
	mu     sync.RWMutex
	jobs   map[string]cron.EntryID
}

func New(db *pgxpool.Pool, redis *redis.Client, logger *zap.Logger) *Scheduler {
	return &Scheduler{
		db:     db,
		redis:  redis,
		cron:   cron.New(cron.WithSeconds()),
		logger: logger,
		jobs:   make(map[string]cron.EntryID),
	}
}

func (s *Scheduler) Start() error {
	if err := s.loadJobs(); err != nil {
		return fmt.Errorf("load jobs: %w", err)
	}

	s.cron.Start()
	return nil
}

func (s *Scheduler) Stop() {
	ctx := s.cron.Stop()
	<-ctx.Done()
}

type cronJob struct {
	ID             string
	CronExpression string
}

func (s *Scheduler) loadJobs() error {
	rows, err := s.db.Query(context.Background(),
		`SELECT id, cron_expression
		 FROM backup_jobs
		 WHERE status = 'active' AND cron_expression IS NOT NULL AND cron_expression != ''`,
	)
	if err != nil {
		return fmt.Errorf("query jobs: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var job cronJob
		if err := rows.Scan(&job.ID, &job.CronExpression); err != nil {
			s.logger.Error("scan job", zap.Error(err))
			continue
		}

		s.AddJob(job.ID, job.CronExpression)
	}

	return nil
}

func (s *Scheduler) AddJob(jobID, cronExpr string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.jobs[jobID]; exists {
		return nil
	}

	entryID, err := s.cron.AddFunc(cronExpr, func() {
		s.enqueueJob(jobID)
	})
	if err != nil {
		return fmt.Errorf("add cron: %w", err)
	}

	s.jobs[jobID] = entryID
	s.logger.Info("job scheduled",
		zap.String("job_id", jobID),
		zap.String("cron", cronExpr),
	)

	return nil
}

func (s *Scheduler) RemoveJob(jobID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if entryID, exists := s.jobs[jobID]; exists {
		s.cron.Remove(entryID)
		delete(s.jobs, jobID)
		s.logger.Info("job unscheduled", zap.String("job_id", jobID))
	}
}

func (s *Scheduler) enqueueJob(jobID string) {
	err := s.redis.LPush(context.Background(), "bck:queue:jobs", jobID).Err()
	if err != nil {
		s.logger.Error("enqueue job", zap.String("job_id", jobID), zap.Error(err))
		return
	}

	// Create a job_run record
	_, err = s.db.Exec(context.Background(),
		`INSERT INTO job_runs (job_id, status) VALUES ($1, 'pending')`,
		jobID,
	)
	if err != nil {
		s.logger.Error("create run record", zap.String("job_id", jobID), zap.Error(err))
	}

	s.logger.Info("job enqueued", zap.String("job_id", jobID))
}
