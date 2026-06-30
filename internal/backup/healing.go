package backup

import (
	"context"
	"sync"
	"time"

	"go.uber.org/zap"
)

type ServiceName string

const (
	ServiceAPI       ServiceName = "api"
	ServiceWorker    ServiceName = "worker"
	ServiceScheduler ServiceName = "scheduler"
	ServiceAgent     ServiceName = "agent"
	ServicePostgres  ServiceName = "postgres"
	ServiceRedis     ServiceName = "redis"
)

type ServiceStatus struct {
	Name      ServiceName `json:"name"`
	Healthy   bool        `json:"healthy"`
	LastCheck time.Time   `json:"last_check"`
	ConsecutiveFailures int `json:"consecutive_failures"`
	Message   string     `json:"message,omitempty"`
}

type CircuitBreaker struct {
	failureThreshold int
	resetTimeout     time.Duration
	failureCount     int
	lastFailure      time.Time
	state            string // closed, open, half-open
	mu               sync.Mutex
}

func NewCircuitBreaker(failureThreshold int, resetTimeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		failureThreshold: failureThreshold,
		resetTimeout:     resetTimeout,
		state:            "closed",
	}
}

func (cb *CircuitBreaker) State() string {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state
}

func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case "closed":
		return true
	case "open":
		if time.Since(cb.lastFailure) > cb.resetTimeout {
			cb.state = "half-open"
			return true
		}
		return false
	case "half-open":
		return true
	}
	return false
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failureCount = 0
	if cb.state == "half-open" {
		cb.state = "closed"
	}
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failureCount++
	cb.lastFailure = time.Now()
	if cb.failureCount >= cb.failureThreshold {
		cb.state = "open"
	}
}

type FailoverManager struct {
	primary   string
	fallbacks []string
	current   string
	mu        sync.RWMutex
	logger    *zap.Logger
}

func NewFailoverManager(primary string, fallbacks []string, logger *zap.Logger) *FailoverManager {
	return &FailoverManager{
		primary:   primary,
		fallbacks: fallbacks,
		current:   primary,
		logger:    logger,
	}
}

func (fm *FailoverManager) Current() string {
	fm.mu.RLock()
	defer fm.mu.RUnlock()
	return fm.current
}

func (fm *FailoverManager) Failover() string {
	fm.mu.Lock()
	defer fm.mu.Unlock()

	for _, fb := range fm.fallbacks {
		if fb != fm.current {
			fm.current = fb
			fm.logger.Warn("failover triggered",
				zap.String("from", fm.primary),
				zap.String("to", fb),
			)
			return fb
		}
	}
	return fm.current
}

func (fm *FailoverManager) Restore() {
	fm.mu.Lock()
	defer fm.mu.Unlock()
	if fm.current != fm.primary {
		fm.logger.Info("restoring primary")
		fm.current = fm.primary
	}
}

type SelfHealingManager struct {
	services map[ServiceName]*ServiceStatus
	breakers map[ServiceName]*CircuitBreaker
	checkFn  func(ServiceName) bool
	mu       sync.RWMutex
	logger   *zap.Logger
}

func NewSelfHealingManager(logger *zap.Logger) *SelfHealingManager {
	sm := &SelfHealingManager{
		services: make(map[ServiceName]*ServiceStatus),
		breakers: make(map[ServiceName]*CircuitBreaker),
		logger:   logger,
	}

	for _, svc := range []ServiceName{ServiceAPI, ServiceWorker, ServiceScheduler, ServicePostgres, ServiceRedis} {
		sm.services[svc] = &ServiceStatus{
			Name:    svc,
			Healthy: true,
		}
		sm.breakers[svc] = NewCircuitBreaker(5, 30*time.Second)
	}

	return sm
}

func (sm *SelfHealingManager) SetChecker(fn func(ServiceName) bool) {
	sm.checkFn = fn
}

func (sm *SelfHealingManager) CheckAll() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for _, svc := range sm.services {
		var healthy bool

		if sm.checkFn != nil {
			healthy = sm.checkFn(svc.Name)
		} else {
			healthy = true
		}

		svc.LastCheck = time.Now()
		breaker := sm.breakers[svc.Name]

		if healthy {
			svc.Healthy = true
			svc.ConsecutiveFailures = 0
			breaker.RecordSuccess()
		} else {
			svc.ConsecutiveFailures++
			breaker.RecordFailure()

			if svc.ConsecutiveFailures >= 3 {
				svc.Healthy = false
				svc.Message = "service unresponsive"

				sm.logger.Error("service degraded",
					zap.String("service", string(svc.Name)),
					zap.Int("failures", svc.ConsecutiveFailures),
				)

				sm.triggerHealing(svc.Name)
			}
		}
	}
}

func (sm *SelfHealingManager) triggerHealing(name ServiceName) {
	actions := map[ServiceName][]string{
		ServicePostgres: {"restart postgresql", "check disk space", "verify connections"},
		ServiceRedis:    {"restart redis-server", "flush cache", "check memory"},
		ServiceWorker:   {"restart bck-worker", "scale up workers", "clear stuck jobs"},
		ServiceAPI:      {"restart bck-api", "check rate limits", "clear connection pool"},
		ServiceScheduler: {"restart bck-scheduler", "reload job config", "clear stale locks"},
	}

	if actions, ok := actions[name]; ok {
		for _, action := range actions {
			sm.logger.Info("self-healing action",
				zap.String("service", string(name)),
				zap.String("action", action),
			)
		}
	}
}

func (sm *SelfHealingManager) Start(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	sm.logger.Info("self-healing manager started", zap.Duration("interval", interval))

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sm.CheckAll()
		}
	}
}

func (sm *SelfHealingManager) Status() map[ServiceName]*ServiceStatus {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make(map[ServiceName]*ServiceStatus)
	for k, v := range sm.services {
		status := *v
		result[k] = &status
	}
	return result
}

func (sm *SelfHealingManager) BreakerState(name ServiceName) string {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	if b, ok := sm.breakers[name]; ok {
		return b.State()
	}
	return "unknown"
}
