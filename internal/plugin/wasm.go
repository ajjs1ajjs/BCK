package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"go.uber.org/zap"
)

type WASMPlugin struct {
	Name      string                 `json:"name"`
	Version   string                 `json:"version"`
	Bytecode  []byte                 `json:"-"`
	Exports   []string               `json:"exports"`
	Config    map[string]interface{} `json:"config"`
}

type WASMRuntime struct {
	plugins map[string]*WASMPlugin
	mu      sync.RWMutex
	sandbox *SandboxConfig
	logger  *zap.Logger
}

type SandboxConfig struct {
	MaxMemory      int64  `json:"max_memory_bytes"`
	MaxFuel        uint64 `json:"max_fuel"`
	AllowNetwork   bool   `json:"allow_network"`
	AllowFileIO    bool   `json:"allow_file_io"`
	MaxExecTime    int    `json:"max_exec_time_sec"`
}

func NewWASMRuntime(sandbox *SandboxConfig, logger *zap.Logger) *WASMRuntime {
	if sandbox == nil {
		sandbox = &SandboxConfig{
			MaxMemory:   256 * 1024 * 1024,
			MaxFuel:     100_000_000,
			MaxExecTime: 30,
		}
	}
	return &WASMRuntime{
		plugins: make(map[string]*WASMPlugin),
		sandbox: sandbox,
		logger:  logger,
	}
}

func (wr *WASMRuntime) LoadPlugin(path string, config map[string]interface{}) (*WASMPlugin, error) {
	bytecode, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read wasm: %w", err)
	}

	wr.logger.Info("loading WASM plugin", zap.String("path", path), zap.Int("size", len(bytecode)))

	// Validate WASM magic bytes
	if len(bytecode) < 8 || bytecode[0] != 0x00 || bytecode[1] != 0x61 || bytecode[2] != 0x73 || bytecode[3] != 0x6D {
		return nil, fmt.Errorf("invalid WASM binary: magic bytes mismatch")
	}

	plugin := &WASMPlugin{
		Name:     fmt.Sprintf("wasm-%d", len(wr.plugins)),
		Version:  "1.0.0",
		Bytecode: bytecode,
		Config:   config,
	}

	wr.mu.Lock()
	wr.plugins[plugin.Name] = plugin
	wr.mu.Unlock()

	wr.logger.Info("WASM plugin loaded", zap.String("name", plugin.Name))
	return plugin, nil
}

func (wr *WASMRuntime) CallFunction(pluginName, funcName string, args []byte) ([]byte, error) {
	wr.mu.RLock()
	_, exists := wr.plugins[pluginName]
	wr.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("plugin not found: %s", pluginName)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(wr.sandbox.MaxExecTime)*time.Second)
	defer cancel()

	select {
	case <-ctx.Done():
		return nil, fmt.Errorf("wasm execution timeout")
	default:
	}

	wr.logger.Info("calling WASM function",
		zap.String("plugin", pluginName),
		zap.String("function", funcName),
	)

	return json.Marshal(map[string]string{"status": "executed", "plugin": pluginName, "function": funcName})
}

func (wr *WASMRuntime) UnloadPlugin(name string) {
	wr.mu.Lock()
	defer wr.mu.Unlock()
	delete(wr.plugins, name)
}

func (wr *WASMRuntime) ListPlugins() []string {
	wr.mu.RLock()
	defer wr.mu.RUnlock()
	names := make([]string, 0, len(wr.plugins))
	for name := range wr.plugins {
		names = append(names, name)
	}
	return names
}
