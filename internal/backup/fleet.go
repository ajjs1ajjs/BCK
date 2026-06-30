package backup

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"go.uber.org/zap"
)

type FleetAgent struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Version     string    `json:"version"`
	Status      string    `json:"status"` // online, offline, updating, error
	Group       string    `json:"group"`
	Tags        []string  `json:"tags"`
	Host        string    `json:"host"`
	LastSeen    time.Time `json:"last_seen"`
	VersionTarget string  `json:"version_target,omitempty"`
	Metrics     AgentMetrics `json:"metrics"`
}

type AgentMetrics struct {
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryMB      float64 `json:"memory_mb"`
	DiskFreeGB    float64 `json:"disk_free_gb"`
	JobsCompleted int64   `json:"jobs_completed"`
	BytesThroughput float64 `json:"bytes_throughput"`
	UptimeSeconds int64   `json:"uptime_seconds"`
}

type UpdateStrategy string

const (
	UpdateRolling  UpdateStrategy = "rolling"  // One by one
	UpdateCanary   UpdateStrategy = "canary"   // 10% first, then rest
	UpdateParallel UpdateStrategy = "parallel" // All at once (N%)
	UpdateBlueGreen UpdateStrategy = "blue_green" // New fleet, switch
)

type FleetUpdate struct {
	ID          string         `json:"id"`
	Version     string         `json:"version"`
	Strategy    UpdateStrategy `json:"strategy"`
	Groups      []string       `json:"groups,omitempty"`
	MaxParallel int            `json:"max_parallel"`
	CanaryPercent int          `json:"canary_percent"`
	Status      string         `json:"status"`
	StartedAt   time.Time      `json:"started_at"`
	CompletedAt time.Time      `json:"completed_at,omitempty"`
}

type FleetManager struct {
	agents   map[string]*FleetAgent
	updates  map[string]*FleetUpdate
	groups   map[string][]string
	mu       sync.RWMutex
	logger   *zap.Logger
}

func NewFleetManager(logger *zap.Logger) *FleetManager {
	return &FleetManager{
		agents:  make(map[string]*FleetAgent),
		updates: make(map[string]*FleetUpdate),
		groups:  make(map[string][]string),
		logger:  logger,
	}
}

func (fm *FleetManager) Register(agent *FleetAgent) {
	fm.mu.Lock()
	defer fm.mu.Unlock()

	agent.LastSeen = time.Now()
	fm.agents[agent.ID] = agent

	if agent.Group != "" {
		fm.groups[agent.Group] = append(fm.groups[agent.Group], agent.ID)
	}

	fm.logger.Info("agent registered in fleet",
		zap.String("agent", agent.Name),
		zap.String("group", agent.Group),
		zap.Int("total_agents", len(fm.agents)),
	)
}

func (fm *FleetManager) List() []*FleetAgent {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	agents := make([]*FleetAgent, 0, len(fm.agents))
	for _, a := range fm.agents {
		agents = append(agents, a)
	}
	return agents
}

func (fm *FleetManager) ListByGroup(group string) []*FleetAgent {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	var agents []*FleetAgent
	for _, id := range fm.groups[group] {
		if a, ok := fm.agents[id]; ok {
			agents = append(agents, a)
		}
	}
	return agents
}

func (fm *FleetManager) BulkCommand(ctx context.Context, group string, command string, args map[string]string) error {
	fm.mu.RLock()
	agents := fm.ListByGroup(group)
	fm.mu.RUnlock()

	if len(agents) == 0 {
		return fmt.Errorf("no agents in group: %s", group)
	}

	fm.logger.Info("bulk command",
		zap.String("group", group),
		zap.String("command", command),
		zap.Int("agents", len(agents)),
	)

	var wg sync.WaitGroup
	errs := make(chan error, len(agents))

	for _, agent := range agents {
		wg.Add(1)
		go func(a *FleetAgent) {
			defer wg.Done()
			fm.logger.Info("executing on agent", zap.String("agent", a.Name))
		}(agent)
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			return err
		}
	}

	return nil
}

func (fm *FleetManager) StartUpdate(update *FleetUpdate) error {
	fm.mu.Lock()
	defer fm.mu.Unlock()

	update.Status = "started"
	update.StartedAt = time.Now()
	fm.updates[update.ID] = update

	fm.logger.Info("fleet update started",
		zap.String("version", update.Version),
		zap.String("strategy", string(update.Strategy)),
	)

	return nil
}

func (fm *FleetManager) ExecuteUpdate(ctx context.Context, updateID string) error {
	fm.mu.RLock()
	update, exists := fm.updates[updateID]
	fm.mu.RUnlock()

	if !exists {
		return fmt.Errorf("update not found: %s", updateID)
	}

	var targets []*FleetAgent

	if len(update.Groups) > 0 {
		for _, group := range update.Groups {
			targets = append(targets, fm.ListByGroup(group)...)
		}
	} else {
		targets = fm.List()
	}

	switch update.Strategy {
	case UpdateRolling:
		return fm.rollingUpdate(ctx, update, targets)
	case UpdateCanary:
		return fm.canaryUpdate(ctx, update, targets)
	case UpdateParallel:
		return fm.parallelUpdate(ctx, update, targets)
	default:
		return fmt.Errorf("unknown strategy: %s", update.Strategy)
	}
}

func (fm *FleetManager) rollingUpdate(ctx context.Context, update *FleetUpdate, agents []*FleetAgent) error {
	for _, agent := range agents {
		if agent.Status != "online" {
			continue
		}

		fm.logger.Info("updating agent (rolling)", zap.String("agent", agent.Name))
		agent.Status = "updating"
		agent.VersionTarget = update.Version

		time.Sleep(5 * time.Second)

		agent.Version = update.Version
		agent.Status = "online"
	}

	update.Status = "completed"
	update.CompletedAt = time.Now()
	fm.logger.Info("rolling update completed", zap.Int("agents", len(agents)))
	return nil
}

func (fm *FleetManager) canaryUpdate(ctx context.Context, update *FleetUpdate, agents []*FleetAgent) error {
	canaryCount := len(agents) * update.CanaryPercent / 100
	if canaryCount < 1 {
		canaryCount = 1
	}

	canary := agents[:canaryCount]
	rest := agents[canaryCount:]

	fm.logger.Info("canary update: phase 1",
		zap.Int("canary", len(canary)),
		zap.Int("rest", len(rest)),
	)

	// Phase 1: update canary
	for _, agent := range canary {
		agent.Version = update.Version
		agent.VersionTarget = update.Version
	}

	// Wait for canary to bake
	time.Sleep(30 * time.Second)

	// Phase 2: update rest
	for _, agent := range rest {
		agent.Version = update.Version
	}

	update.Status = "completed"
	update.CompletedAt = time.Now()
	return nil
}

func (fm *FleetManager) parallelUpdate(ctx context.Context, update *FleetUpdate, agents []*FleetAgent) error {
	parallel := update.MaxParallel
	if parallel <= 0 || parallel > len(agents) {
		parallel = len(agents)
	}

	sem := make(chan struct{}, parallel)
	var wg sync.WaitGroup

	for _, agent := range agents {
		wg.Add(1)
		sem <- struct{}{}

		go func(a *FleetAgent) {
			defer wg.Done()
			defer func() { <-sem }()
			a.Version = update.Version
			time.Sleep(time.Duration(rand.Intn(3)+1) * time.Second)
		}(agent)
	}

	wg.Wait()
	update.Status = "completed"
	update.CompletedAt = time.Now()
	return nil
}

func (fm *FleetManager) FleetStats() map[string]interface{} {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	stats := map[string]interface{}{
		"total_agents": len(fm.agents),
		"online":       0,
		"offline":      0,
		"updating":     0,
		"groups":       len(fm.groups),
		"versions":     make(map[string]int),
	}

	for _, a := range fm.agents {
		switch a.Status {
		case "online":
			stats["online"] = stats["online"].(int) + 1
		case "offline":
			stats["offline"] = stats["offline"].(int) + 1
		case "updating":
			stats["updating"] = stats["updating"].(int) + 1
		}
		stats["versions"].(map[string]int)[a.Version]++
	}

	return stats
}
