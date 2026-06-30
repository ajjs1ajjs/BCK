package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ajjs1ajjs/BCK/internal/config"
	"github.com/ajjs1ajjs/BCK/internal/scheduler"
	"github.com/ajjs1ajjs/BCK/internal/store"
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

	sched := scheduler.New(db, rdb, logger)
	if err := sched.Start(); err != nil {
		logger.Fatal("start scheduler", zap.Error(err))
	}

	logger.Info("scheduler started")

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down scheduler...")
	sched.Stop()
}
