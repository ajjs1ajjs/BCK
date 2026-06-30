package backup

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

type TriggerType string

const (
	TriggerJobComplete  TriggerType = "job_complete"
	TriggerJobFailed    TriggerType = "job_failed"
	TriggerSnapshotCreated TriggerType = "snapshot_created"
	TriggerRansomwareAlert TriggerType = "ransomware_alert"
	TriggerStorageThreshold TriggerType = "storage_threshold"
	TriggerHealthDegraded TriggerType = "health_degraded"
	TriggerSchedule      TriggerType = "schedule"
	TriggerManual        TriggerType = "manual"
)

type RuleAction struct {
	Type     string            `json:"type"` // webhook, exec, notify, sleep, enqueue, tag
	Config   map[string]string `json:"config"`
	Timeout  time.Duration     `json:"timeout"`
}

type AutomationRule struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Trigger     TriggerType   `json:"trigger"`
	Condition   string        `json:"condition"` // JSON path expression
	Actions     []RuleAction  `json:"actions"`
	Enabled     bool          `json:"enabled"`
	Cooldown    time.Duration `json:"cooldown"`
	LastFired   time.Time     `json:"last_fired"`
	Priority    int           `json:"priority"` // higher = earlier
}

type EventPayload struct {
	Type      TriggerType              `json:"type"`
	Timestamp time.Time                `json:"timestamp"`
	Source    string                   `json:"source"`
	Data      map[string]interface{}   `json:"data"`
	Context   map[string]interface{}   `json:"context,omitempty"`
}

type AutomationEngine struct {
	rules     map[string]*AutomationRule
	handlers  map[string]func(context.Context, RuleAction, *EventPayload) error
	eventCh   chan *EventPayload
	mu        sync.RWMutex
	logger    *zap.Logger
	metrics   map[string]int64
}

func NewAutomationEngine(logger *zap.Logger) *AutomationEngine {
	ae := &AutomationEngine{
		rules:    make(map[string]*AutomationRule),
		handlers: make(map[string]func(context.Context, RuleAction, *EventPayload) error),
		eventCh:  make(chan *EventPayload, 1000),
		logger:   logger,
		metrics:  make(map[string]int64),
	}

	ae.registerBuiltinHandlers()
	return ae
}

func (ae *AutomationEngine) registerBuiltinHandlers() {
	ae.RegisterActionHandler("webhook", func(ctx context.Context, action RuleAction, event *EventPayload) error {
		url := action.Config["url"]
		method := action.Config["method"]
		if method == "" {
			method = "POST"
		}
		ae.logger.Info("firing webhook", zap.String("url", url), zap.String("method", method))
		return nil
	})

	ae.RegisterActionHandler("notify", func(ctx context.Context, action RuleAction, event *EventPayload) error {
		channel := action.Config["channel"]
		message := action.Config["message"]
		ae.logger.Info("sending notification",
			zap.String("channel", channel),
			zap.String("message", message),
		)
		return nil
	})

	ae.RegisterActionHandler("exec", func(ctx context.Context, action RuleAction, event *EventPayload) error {
		command := action.Config["command"]
		ae.logger.Info("executing command", zap.String("command", command))
		return nil
	})

	ae.RegisterActionHandler("sleep", func(ctx context.Context, action RuleAction, event *EventPayload) error {
		dur, _ := time.ParseDuration(action.Config["duration"])
		if dur > 0 {
			time.Sleep(dur)
		}
		return nil
	})

	ae.RegisterActionHandler("enqueue", func(ctx context.Context, action RuleAction, event *EventPayload) error {
		jobID := action.Config["job_id"]
		ae.logger.Info("enqueueing job", zap.String("job_id", jobID))
		return nil
	})

	ae.RegisterActionHandler("tag", func(ctx context.Context, action RuleAction, event *EventPayload) error {
		tag := action.Config["tag"]
		snapshotID := action.Config["snapshot_id"]
		ae.logger.Info("tagging snapshot", zap.String("snapshot", snapshotID), zap.String("tag", tag))
		return nil
	})
}

func (ae *AutomationEngine) RegisterActionHandler(name string, handler func(context.Context, RuleAction, *EventPayload) error) {
	ae.handlers[name] = handler
}

func (ae *AutomationEngine) AddRule(rule *AutomationRule) {
	ae.mu.Lock()
	defer ae.mu.Unlock()
	ae.rules[rule.ID] = rule
	ae.logger.Info("automation rule added", zap.String("name", rule.Name), zap.String("trigger", string(rule.Trigger)))
}

func (ae *AutomationEngine) RemoveRule(id string) {
	ae.mu.Lock()
	defer ae.mu.Unlock()
	delete(ae.rules, id)
}

func (ae *AutomationEngine) Emit(payload *EventPayload) {
	select {
	case ae.eventCh <- payload:
	default:
		ae.logger.Warn("event channel full, dropping event")
	}
}

func (ae *AutomationEngine) Start(ctx context.Context) {
	ae.logger.Info("automation engine started")

	for {
		select {
		case <-ctx.Done():
			return
		case event := <-ae.eventCh:
			ae.processEvent(ctx, event)
		}
	}
}

func (ae *AutomationEngine) processEvent(ctx context.Context, event *EventPayload) {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	for _, rule := range ae.rules {
		if !rule.Enabled {
			continue
		}
		if rule.Trigger != event.Type && rule.Trigger != "*" {
			continue
		}
		if rule.Cooldown > 0 && time.Since(rule.LastFired) < rule.Cooldown {
			continue
		}
		if rule.Condition != "" && !ae.evaluateCondition(rule.Condition, event) {
			continue
		}

		ae.logger.Info("rule triggered",
			zap.String("rule", rule.Name),
			zap.String("event", string(event.Type)),
		)

		rule.LastFired = time.Now()

		go ae.executeRule(ctx, rule, event)
	}
}

func (ae *AutomationEngine) executeRule(ctx context.Context, rule *AutomationRule, event *EventPayload) {
	for _, action := range rule.Actions {
		handler, exists := ae.handlers[action.Type]
		if !exists {
			ae.logger.Warn("no handler for action type", zap.String("type", action.Type))
			continue
		}

		err := handler(ctx, action, event)
		if err != nil {
			ae.logger.Error("rule action failed",
				zap.String("rule", rule.Name),
				zap.String("action", action.Type),
				zap.Error(err),
			)
		}

		ae.mu.Lock()
		ae.metrics[fmt.Sprintf("%s.%s.executed", rule.ID, action.Type)]++
		ae.mu.Unlock()
	}
}

func (ae *AutomationEngine) evaluateCondition(condition string, event *EventPayload) bool {
	// Simple JSON path condition evaluator
	// Supports: data.field == value, data.field > number, etc.
	parts := splitCondition(condition)
	if len(parts) < 3 {
		return true
	}

	path := parts[0]
	op := parts[1]
	expected := parts[2]

	value := getJSONPath(event.Data, path)
	if value == nil {
		return false
	}

	return compareValues(value, op, expected)
}

func splitCondition(cond string) []string {
	var parts []string
	var current string
	inQuote := false

	for _, ch := range cond {
		switch {
		case ch == '"':
			inQuote = !inQuote
		case ch == ' ' && !inQuote:
			if current != "" {
				parts = append(parts, current)
				current = ""
			}
		default:
			current += string(ch)
		}
	}
	if current != "" {
		parts = append(parts, strings.Trim(current, `"`))
	}
	return parts
}

func getJSONPath(data map[string]interface{}, path string) interface{} {
	parts := strings.Split(path, ".")
	current := interface{}(data)

	for _, part := range parts {
		m, ok := current.(map[string]interface{})
		if !ok {
			return nil
		}
		current = m[part]
	}
	return current
}

func compareValues(value interface{}, op, expected string) bool {
	valStr := fmt.Sprintf("%v", value)
	switch op {
	case "==":
		return valStr == expected
	case "!=":
		return valStr != expected
	case ">":
		return valStr > expected
	case "<":
		return valStr < expected
	case "contains":
		return strings.Contains(valStr, expected)
	default:
		return true
	}
}

func (ae *AutomationEngine) GetMetrics() map[string]int64 {
	ae.mu.RLock()
	defer ae.mu.RUnlock()
	result := make(map[string]int64)
	for k, v := range ae.metrics {
		result[k] = v
	}
	return result
}

func (ae *AutomationEngine) ListRules() []*AutomationRule {
	ae.mu.RLock()
	defer ae.mu.RUnlock()
	rules := make([]*AutomationRule, 0, len(ae.rules))
	for _, r := range ae.rules {
		rules = append(rules, r)
	}
	return rules
}
