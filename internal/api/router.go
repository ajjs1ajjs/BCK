package api

import (
	"time"

	"github.com/ajjs1ajjs/BCK/internal/api/handlers"
	"github.com/ajjs1ajjs/BCK/internal/api/middleware"
	"github.com/ajjs1ajjs/BCK/internal/config"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

func NewRouter(cfg *config.Config, db *pgxpool.Pool, logger *zap.Logger) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(middleware.Logger(logger))
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORS.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"Link", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	r.Use(chimw.Timeout(60 * time.Second))

	// Rate limiter
	r.Use(middleware.RateLimiter(100, 200))

	rdb := redis.NewClient(&redis.Options{
		Addr: cfg.Redis.Addr(),
	})

	h := handlers.New(cfg, db, rdb, logger)

	// Health (no auth)
	r.Get("/api/v1/health", h.Health)
	r.Get("/api/v1/ready", h.Ready)

	// Metrics
	r.Handle("/metrics", promhttp.Handler())

	// Auth routes
	r.Route("/api/v1/auth", func(r chi.Router) {
		r.Post("/login", h.Login)
		r.Post("/refresh", h.RefreshToken)
		r.With(middleware.Auth(cfg, logger)).Get("/me", h.GetCurrentUser)
	})

	// Protected routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.Auth(cfg, logger))

		// Jobs
		r.Route("/jobs", func(r chi.Router) {
			r.Get("/", h.ListJobs)
			r.Post("/", h.CreateJob)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.GetJob)
				r.Put("/", h.UpdateJob)
				r.Delete("/", h.DeleteJob)
				r.Post("/run", h.RunJob)
				r.Get("/runs", h.ListJobRuns)
			})
		})

		// Repositories
		r.Route("/repositories", func(r chi.Router) {
			r.Get("/", h.ListRepositories)
			r.Post("/", h.CreateRepository)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.GetRepository)
				r.Put("/", h.UpdateRepository)
				r.Delete("/", h.DeleteRepository)
			})
		})

		// Snapshots
		r.Get("/snapshots", h.ListSnapshots)

		// Restore
		r.Post("/restore", h.StartRestore)
		r.Get("/restore/{id}", h.GetRestoreStatus)

		// Stats
		r.Get("/stats", h.GetStats)

		// Agents
		r.Route("/agents", func(r chi.Router) {
			r.Get("/", h.ListAgents)
			r.Post("/", h.RegisterAgent)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.GetAgent)
				r.Put("/", h.UpdateAgent)
				r.Delete("/", h.DeleteAgent)
			})
		})
	})

	return r
}
