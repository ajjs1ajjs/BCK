package plugin

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"

	"go.uber.org/zap"
)

type HookPhase string

const (
	HookPreBackup     HookPhase = "pre_backup"
	HookPostBackup    HookPhase = "post_backup"
	HookPreRestore    HookPhase = "pre_restore"
	HookPostRestore   HookPhase = "post_restore"
	HookPreDelete     HookPhase = "pre_delete"
	HookOnFailure     HookPhase = "on_failure"
	HookOnSuccess     HookPhase = "on_success"
)

type HookConfig struct {
	Name    string            `json:"name"`
	Phase   HookPhase         `json:"phase"`
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Timeout time.Duration     `json:"timeout"`
	Env     map[string]string `json:"env,omitempty"`
	Enabled bool              `json:"enabled"`
}

type HookResult struct {
	Name     string        `json:"name"`
	Phase    HookPhase     `json:"phase"`
	Success  bool          `json:"success"`
	Duration time.Duration `json:"duration"`
	Output   string        `json:"output,omitempty"`
	Error    string        `json:"error,omitempty"`
}

type ContextData struct {
	JobID      string            `json:"job_id"`
	JobName    string            `json:"job_name"`
	SnapshotID string            `json:"snapshot_id,omitempty"`
	Status     string            `json:"status,omitempty"`
	Error      string            `json:"error,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

type HookManager struct {
	hooks  []HookConfig
	mu     sync.RWMutex
	logger *zap.Logger
}

func NewHookManager(logger *zap.Logger) *HookManager {
	return &HookManager{
		hooks:  make([]HookConfig, 0),
		logger: logger,
	}
}

func (hm *HookManager) Register(hook HookConfig) {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	hm.hooks = append(hm.hooks, hook)
	hm.logger.Info("hook registered", zap.String("name", hook.Name), zap.String("phase", string(hook.Phase)))
}

func (hm *HookManager) Remove(name string) {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	for i, h := range hm.hooks {
		if h.Name == name {
			hm.hooks = append(hm.hooks[:i], hm.hooks[i+1:]...)
			return
		}
	}
}

func (hm *HookManager) Execute(ctx context.Context, phase HookPhase, data *ContextData) []HookResult {
	hm.mu.RLock()
	hooks := make([]HookConfig, len(hm.hooks))
	copy(hooks, hm.hooks)
	hm.mu.RUnlock()

	var results []HookResult

	for _, hook := range hooks {
		if hook.Phase != phase || !hook.Enabled {
			continue
		}

		result := hm.executeHook(ctx, hook, data)
		results = append(results, result)

		if !result.Success {
			hm.logger.Error("hook failed",
				zap.String("name", hook.Name),
				zap.String("error", result.Error),
			)
		}
	}

	return results
}

func (hm *HookManager) executeHook(ctx context.Context, hook HookConfig, data *ContextData) HookResult {
	result := HookResult{
		Name:  hook.Name,
		Phase: hook.Phase,
	}

	timeout := hook.Timeout
	if timeout == 0 {
		timeout = 5 * time.Minute
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, hook.Command, hook.Args...)
	cmd.Env = os.Environ()

	for k, v := range hook.Env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	cmd.Env = append(cmd.Env,
		fmt.Sprintf("BCK_JOB_ID=%s", data.JobID),
		fmt.Sprintf("BCK_JOB_NAME=%s", data.JobName),
		fmt.Sprintf("BCK_SNAPSHOT_ID=%s", data.SnapshotID),
		fmt.Sprintf("BCK_STATUS=%s", data.Status),
	)

	start := time.Now()
	output, err := cmd.CombinedOutput()
	result.Duration = time.Since(start)
	result.Output = string(output)

	if err != nil {
		result.Error = err.Error()
		result.Success = false
	} else {
		result.Success = true
	}

	hm.logger.Info("hook executed",
		zap.String("name", hook.Name),
		zap.Bool("success", result.Success),
		zap.Duration("duration", result.Duration),
	)

	return result
}

func (hm *HookManager) ListHooks() []HookConfig {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	result := make([]HookConfig, len(hm.hooks))
	copy(result, hm.hooks)
	return result
}

// Plugin SDK interface for Go-based plugins
type Plugin interface {
	Name() string
	Version() string
	Initialize(config map[string]interface{}) error
	OnEvent(event string, data *ContextData) error
	Shutdown() error
}

type PluginRegistry struct {
	plugins map[string]Plugin
	mu      sync.RWMutex
}

func NewPluginRegistry() *PluginRegistry {
	return &PluginRegistry{
		plugins: make(map[string]Plugin),
	}
}

func (pr *PluginRegistry) Register(p Plugin) error {
	pr.mu.Lock()
	defer pr.mu.Unlock()
	if _, exists := pr.plugins[p.Name()]; exists {
		return fmt.Errorf("plugin %s already registered", p.Name())
	}
	pr.plugins[p.Name()] = p
	return nil
}

func (pr *PluginRegistry) Get(name string) (Plugin, bool) {
	pr.mu.RLock()
	defer pr.mu.RUnlock()
	p, ok := pr.plugins[name]
	return p, ok
}

func (pr *PluginRegistry) List() []string {
	pr.mu.RLock()
	defer pr.mu.RUnlock()
	names := make([]string, 0, len(pr.plugins))
	for name := range pr.plugins {
		names = append(names, name)
	}
	return names
}
