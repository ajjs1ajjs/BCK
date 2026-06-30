package worker

import (
	"context"
	"sync"

	"github.com/ajjs1ajjs/BCK/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Pool struct {
	db      *pgxpool.Pool
	redis   *redis.Client
	cfg     *config.Config
	logger  *zap.Logger
	size    int
	workers []*Worker
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

func NewPool(db *pgxpool.Pool, redis *redis.Client, cfg *config.Config, logger *zap.Logger, size int) *Pool {
	if size <= 0 {
		size = 4
	}

	return &Pool{
		db:     db,
		redis:  redis,
		cfg:    cfg,
		logger: logger,
		size:   size,
	}
}

func (p *Pool) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel

	for i := 0; i < p.size; i++ {
		w := New(i+1, p.db, p.redis, p.cfg, p.logger)
		p.workers = append(p.workers, w)

		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			w.Run(ctx)
		}()
	}

	p.logger.Info("worker pool started", zap.Int("size", p.size))
}

func (p *Pool) Stop() {
	if p.cancel != nil {
		p.cancel()
	}
	p.wg.Wait()
	p.logger.Info("worker pool stopped")
}
