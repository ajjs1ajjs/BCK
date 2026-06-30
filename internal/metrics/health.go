package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type HealthStatus string

const (
	HealthHealthy   HealthStatus = "healthy"
	HealthDegraded  HealthStatus = "degraded"
	HealthUnhealthy HealthStatus = "unhealthy"
)

type ComponentHealth struct {
	Name      string        `json:"name"`
	Status    HealthStatus  `json:"status"`
	Latency   time.Duration `json:"latency_ms"`
	Message   string        `json:"message,omitempty"`
	CheckedAt time.Time     `json:"checked_at"`
}

type SystemHealth struct {
	Status      HealthStatus       `json:"status"`
	Score       int                `json:"score"` // 0-100
	Components  []ComponentHealth  `json:"components"`
	CheckedAt   time.Time         `json:"checked_at"`
	UptimeHours float64           `json:"uptime_hours"`
}

type HealthChecker struct {
	db      *pgxpool.Pool
	redis   *redis.Client
	started time.Time
	mu      sync.RWMutex
}

func NewHealthChecker(db *pgxpool.Pool, redis *redis.Client) *HealthChecker {
	return &HealthChecker{
		db:      db,
		redis:   redis,
		started: time.Now(),
	}
}

func (h *HealthChecker) Check(ctx context.Context) *SystemHealth {
	var components []ComponentHealth

	components = append(components, h.checkPostgres(ctx))
	components = append(components, h.checkRedis(ctx))
	components = append(components, h.checkDisk(ctx))

	score := 100
	degraded := false
	unhealthy := false

	for _, c := range components {
		switch c.Status {
		case HealthUnhealthy:
			unhealthy = true
			score -= 30
		case HealthDegraded:
			degraded = true
			score -= 15
		}
	}

	status := HealthHealthy
	if unhealthy {
		status = HealthUnhealthy
	} else if degraded {
		status = HealthDegraded
	}

	if score < 0 {
		score = 0
	}

	uptime := time.Since(h.started).Hours()

	return &SystemHealth{
		Status:      status,
		Score:       score,
		Components:  components,
		CheckedAt:   time.Now(),
		UptimeHours: uptime,
	}
}

func (h *HealthChecker) checkPostgres(ctx context.Context) ComponentHealth {
	start := time.Now()
	err := h.db.Ping(ctx)
	latency := time.Since(start)

	c := ComponentHealth{
		Name:      "postgresql",
		CheckedAt: time.Now(),
		Latency:   latency,
	}

	if err != nil {
		c.Status = HealthUnhealthy
		c.Message = err.Error()
	} else if latency > time.Second {
		c.Status = HealthDegraded
		c.Message = fmt.Sprintf("high latency: %v", latency)
	} else {
		c.Status = HealthHealthy
	}

	return c
}

func (h *HealthChecker) checkRedis(ctx context.Context) ComponentHealth {
	start := time.Now()
	err := h.redis.Ping(ctx).Err()
	latency := time.Since(start)

	c := ComponentHealth{
		Name:      "redis",
		CheckedAt: time.Now(),
		Latency:   latency,
	}

	if err != nil {
		c.Status = HealthUnhealthy
		c.Message = err.Error()
	} else if latency > 500*time.Millisecond {
		c.Status = HealthDegraded
		c.Message = fmt.Sprintf("high latency: %v", latency)
	} else {
		c.Status = HealthHealthy
	}

	return c
}

func (h *HealthChecker) checkDisk(ctx context.Context) ComponentHealth {
	start := time.Now()
	latency := time.Since(start)

	return ComponentHealth{
		Name:      "disk",
		Status:    HealthHealthy,
		Latency:   latency,
		CheckedAt: time.Now(),
	}
}

func (h *SystemHealth) ToJSON() []byte {
	data, _ := json.MarshalIndent(h, "", "  ")
	return data
}
