package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ajjs1ajjs/BCK/internal/api"
	"github.com/ajjs1ajjs/BCK/internal/config"
	"github.com/ajjs1ajjs/BCK/internal/store"
	"go.uber.org/zap"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("failed to load config", zap.Error(err))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := store.NewPostgresPool(ctx, cfg.Database.DSN())
	if err != nil {
		logger.Fatal("failed to connect to database", zap.Error(err))
	}
	defer db.Close()
	logger.Info("connected to PostgreSQL")

	router := api.NewRouter(cfg, db, logger)

	srv := &http.Server{
		Addr:         cfg.Server.Addr(),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Print startup banner BEFORE starting server
	printStartupBanner(cfg)

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Fatal("server forced to shutdown", zap.Error(err))
	}

	logger.Info("server stopped")
}

func printStartupBanner(cfg *config.Config) {
	localIP := detectLocalIP()
	addr := cfg.Server.Addr()

	lines := []string{
		"",
		"╔══════════════════════════════════════════════════════════════╗",
		"║               BCK Backup Manager v1.0.0                      ║",
		"╠══════════════════════════════════════════════════════════════╣",
		fmt.Sprintf("║  API Server : http://%s           ║", addr),
	}

	if localIP != "" && !strings.HasPrefix(addr, localIP) {
		lines = append(lines, fmt.Sprintf("║  Local IP   : http://%s:%d          ║", localIP, cfg.Server.Port))
	}

	lines = append(lines,
		"╠══════════════════════════════════════════════════════════════╣",
		"║  Default credentials (CHANGE IMMEDIATELY!):                 ║",
		"║    Username : admin                                         ║",
		"║    Password : admin                                         ║",
		"╠══════════════════════════════════════════════════════════════╣",
		"║  ⚠  WARNING: Change the default password before             ║",
		"║     deploying to production!                                ║",
		"║     Use: POST /api/v1/users/change-password                  ║",
		"╚══════════════════════════════════════════════════════════════╝",
		"",
	)

	fmt.Println(strings.Join(lines, "\n"))
}

func detectLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}

	for _, addr := range addrs {
		if ipNet, ok := addr.(*net.IPNet); ok && !ipNet.IP.IsLoopback() && ipNet.IP.To4() != nil {
			if ipNet.IP.IsPrivate() || ipNet.IP.IsGlobalUnicast() {
				return ipNet.IP.String()
			}
		}
	}

	// Fallback: try to get outbound IP
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		localAddr := conn.LocalAddr().(*net.UDPAddr)
		return localAddr.IP.String()
	}

	return ""
}
