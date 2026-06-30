package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/ajjs1ajjs/BCK/internal/agent"
	"github.com/ajjs1ajjs/BCK/internal/config"
	"go.uber.org/zap"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port+1000)

	srv := agent.NewServer(logger)
	logger.Info("starting backup agent gRPC server", zap.String("addr", addr))

	if err := srv.Serve(addr); err != nil {
		logger.Fatal("failed to serve", zap.Error(err))
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("agent stopped")
}
