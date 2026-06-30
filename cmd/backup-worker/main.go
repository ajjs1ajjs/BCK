package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ajjs1ajjs/BCK/internal/config"
	"github.com/ajjs1ajjs/BCK/internal/store"
	"github.com/ajjs1ajjs/BCK/internal/worker"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("load config", zap.Error(err))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	db, err := store.NewPostgresPool(ctx, cfg.Database.DSN())
	cancel()
	if err != nil {
		logger.Fatal("connect db", zap.Error(err))
	}
	defer db.Close()

	rdb := redis.NewClient(&redis.Options{
		Addr: cfg.Redis.Addr(),
	})

	pool := worker.NewPool(db, rdb, cfg, logger, 4)
	pool.Start()

	logger.Info("worker pool started")

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down worker pool...")
	pool.Stop()
}
