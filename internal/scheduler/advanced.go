package scheduler

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type JobDependency struct {
	JobID      string `json:"job_id"`
	DependsOn  string `json:"depends_on"`
	WaitPolicy string `json:"wait_policy"` // success, any, fail
}

type BlackoutWindow struct {
	Name      string    `json:"name"`
	StartTime string    `json:"start_time"` // HH:MM
	EndTime   string    `json:"end_time"`   // HH:MM
	DaysOfWeek []int    `json:"days_of_week"` // 0=Sun, 1=Mon...
	TimeZone  string    `json:"timezone"`
	Enabled   bool      `json:"enabled"`
}

type Priority string

const (
	PriorityLow    Priority = "low"
	PriorityNormal Priority = "normal"
	PriorityHigh   Priority = "high"
	PriorityUrgent Priority = "urgent"
)

type PriorityQueue struct {
	queues   map[Priority][]string
	mu       sync.RWMutex
	redis    *redis.Client
}

func NewPriorityQueue(redis *redis.Client) *PriorityQueue {
	return &PriorityQueue{
		queues: make(map[Priority][]string),
		redis:  redis,
	}
}

func (pq *PriorityQueue) Enqueue(ctx context.Context, jobID string, priority Priority) error {
	key := fmt.Sprintf("bck:queue:%s", priority)
	return pq.redis.LPush(ctx, key, jobID).Err()
}

func (pq *PriorityQueue) Dequeue(ctx context.Context) (string, Priority, error) {
	priorities := []Priority{PriorityUrgent, PriorityHigh, PriorityNormal, PriorityLow}

	for _, p := range priorities {
		key := fmt.Sprintf("bck:queue:%s", p)
		result, err := pq.redis.BRPop(ctx, 1*time.Second, key).Result()
		if err == redis.Nil {
			continue
		}
		if err != nil {
			return "", "", err
		}
		if len(result) >= 2 {
			return result[1], p, nil
		}
	}
	return "", "", redis.Nil
}

func (pq *PriorityQueue) Length(ctx context.Context) map[string]int64 {
	lengths := make(map[string]int64)
	for _, p := range []Priority{PriorityUrgent, PriorityHigh, PriorityNormal, PriorityLow} {
		key := fmt.Sprintf("bck:queue:%s", p)
		l, _ := pq.redis.LLen(ctx, key).Result()
		lengths[string(p)] = l
	}
	return lengths
}

type DAGScheduler struct {
	db       *pgxpool.Pool
	redis    *redis.Client
	deps     map[string][]JobDependency
	blackouts []BlackoutWindow
	mu       sync.RWMutex
	logger   *zap.Logger
}

func NewDAGScheduler(db *pgxpool.Pool, redis *redis.Client, logger *zap.Logger) *DAGScheduler {
	return &DAGScheduler{
		db:        db,
		redis:     redis,
		deps:      make(map[string][]JobDependency),
		blackouts: make([]BlackoutWindow, 0),
		logger:    logger,
	}
}

func (ds *DAGScheduler) AddDependency(dep JobDependency) {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	ds.deps[dep.JobID] = append(ds.deps[dep.JobID], dep)
}

func (ds *DAGScheduler) CanRun(ctx context.Context, jobID string) (bool, string) {
	ds.mu.RLock()
	defer ds.mu.RUnlock()

	deps, exists := ds.deps[jobID]
	if !exists || len(deps) == 0 {
		return true, ""
	}

	for _, dep := range deps {
		var depStatus string
		err := ds.db.QueryRow(ctx,
			`SELECT status FROM job_runs WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`,
			dep.DependsOn,
		).Scan(&depStatus)

		if err != nil || depStatus == "" {
			return false, fmt.Sprintf("dependency %s not yet completed", dep.DependsOn)
		}

		switch dep.WaitPolicy {
		case "success":
			if depStatus != "success" {
				return false, fmt.Sprintf("dependency %s not successful", dep.DependsOn)
			}
		case "any":
			if depStatus == "pending" || depStatus == "running" {
				return false, fmt.Sprintf("dependency %s still running", dep.DependsOn)
			}
		case "fail":
			if depStatus != "failed" {
				return false, fmt.Sprintf("waiting for dependency %s to fail", dep.DependsOn)
			}
		}
	}

	return true, ""
}

func (ds *DAGScheduler) ResolveOrder(ctx context.Context, jobIDs []string) ([]string, error) {
	type node struct {
		id   string
		deps []string
	}

	nodes := make(map[string]*node)
	for _, id := range jobIDs {
		nodes[id] = &node{id: id}
	}

	for _, id := range jobIDs {
		for _, dep := range ds.deps[id] {
			nodes[id].deps = append(nodes[id].deps, dep.DependsOn)
		}
	}

	visited := make(map[string]bool)
	completed := make(map[string]bool)
	var order []string

	var visit func(string) error
	visit = func(id string) error {
		if completed[id] {
			return nil
		}
		if visited[id] {
			return fmt.Errorf("circular dependency detected at %s", id)
		}
		visited[id] = true

		for _, dep := range nodes[id].deps {
			if nodes[dep] == nil {
				nodes[dep] = &node{id: dep}
			}
			if err := visit(dep); err != nil {
				return err
			}
		}

		completed[id] = true
		order = append(order, id)
		return nil
	}

	for _, id := range jobIDs {
		if err := visit(id); err != nil {
			return nil, err
		}
	}

	sort.Strings(order)
	return order, nil
}

func (ds *DAGScheduler) AddBlackout(bw BlackoutWindow) {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	ds.blackouts = append(ds.blackouts, bw)
	ds.logger.Info("blackout window added",
		zap.String("name", bw.Name),
		zap.String("time", bw.StartTime+"-"+bw.EndTime),
	)
}

func (ds *DAGScheduler) IsInBlackout(now time.Time) (bool, *BlackoutWindow) {
	ds.mu.RLock()
	defer ds.mu.RUnlock()

	for i := range ds.blackouts {
		bw := &ds.blackouts[i]
		if !bw.Enabled {
			continue
		}

		dayAllowed := false
		if len(bw.DaysOfWeek) == 0 {
			dayAllowed = true
		} else {
			currentDay := int(now.Weekday())
			for _, d := range bw.DaysOfWeek {
				if d == currentDay {
					dayAllowed = true
					break
				}
			}
		}

		if !dayAllowed {
			continue
		}

		today := now.Format("2006-01-02")
		startTime, _ := time.Parse("2006-01-02 15:04", today+" "+bw.StartTime)
		endTime, _ := time.Parse("2006-01-02 15:04", today+" "+bw.EndTime)

		if now.After(startTime) && now.Before(endTime) {
			return true, bw
		}
	}

	return false, nil
}

func (ds *DAGScheduler) NextAvailableSlot(now time.Time) time.Time {
	for {
		inBlackout, bw := ds.IsInBlackout(now)
		if !inBlackout {
			return now
		}

		today := now.Format("2006-01-02")
		endTime, _ := time.Parse("2006-01-02 15:04", today+" "+bw.EndTime)

		now = endTime.Add(time.Minute)
		if now.Before(time.Now()) {
			now = time.Now()
		}
	}
}
