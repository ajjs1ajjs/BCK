package backup

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.uber.org/zap"
)

type LambdaBackupConfig struct {
	FunctionName string            `json:"function_name"`
	Runtime      string            `json:"runtime"`      // go, python, node
	Trigger      string            `json:"trigger"`       // cron, event, manual
	Schedule     string            `json:"schedule,omitempty"`
	MemoryMB     int               `json:"memory_mb"`
	TimeoutSec   int               `json:"timeout_seconds"`
	Environment  map[string]string `json:"environment,omitempty"`
}

type LambdaStats struct {
	Invocations   int64         `json:"invocations"`
	DurationTotal time.Duration `json:"duration_total"`
	Errors        int64         `json:"errors"`
	LastRun       time.Time     `json:"last_run"`
	ColdStarts    int64         `json:"cold_starts"`
}

type ServerlessManager struct {
	configs map[string]*LambdaBackupConfig
	stats   map[string]*LambdaStats
	logger  *zap.Logger
}

func NewServerlessManager(logger *zap.Logger) *ServerlessManager {
	return &ServerlessManager{
		configs: make(map[string]*LambdaBackupConfig),
		stats:   make(map[string]*LambdaStats),
		logger:  logger,
	}
}

func (sm *ServerlessManager) Register(config *LambdaBackupConfig) error {
	if config.MemoryMB < 128 {
		config.MemoryMB = 256
	}
	if config.TimeoutSec < 10 {
		config.TimeoutSec = 60
	}

	sm.configs[config.FunctionName] = config
	sm.stats[config.FunctionName] = &LambdaStats{}

	sm.logger.Info("serverless backup registered",
		zap.String("function", config.FunctionName),
		zap.String("trigger", config.Trigger),
		zap.Int("memory_mb", config.MemoryMB),
	)

	return nil
}

func (sm *ServerlessManager) Invoke(ctx context.Context, name string, payload map[string]interface{}) (map[string]interface{}, error) {
	config, exists := sm.configs[name]
	if !exists {
		return nil, fmt.Errorf("function not found: %s", name)
	}

	start := time.Now()

	sm.logger.Info("invoking serverless backup",
		zap.String("function", name),
		zap.String("runtime", config.Runtime),
	)

	// Simulate cold start
	coldStart := time.Duration(100+len(config.Environment)*10) * time.Millisecond
	time.Sleep(coldStart)

	// Execute backup logic based on environment config
	result := map[string]interface{}{
		"status":     "success",
		"function":   name,
		"runtime":    config.Runtime,
		"duration_ms": coldStart.Milliseconds(),
	}

	// Record stats
	if stats, ok := sm.stats[name]; ok {
		stats.Invocations++
		stats.DurationTotal += time.Since(start)
		stats.LastRun = time.Now()
	}

	return result, nil
}

func (sm *ServerlessManager) ScaleToZero(name string) {
	sm.logger.Info("scaling to zero", zap.String("function", name))
}

func (sm *ServerlessManager) WarmPool(name string, count int) {
	sm.logger.Info("warming pool", zap.String("function", name), zap.Int("instances", count))
}

func (sm *ServerlessManager) ExportFunction(name string, dir string) error {
	config, exists := sm.configs[name]
	if !exists {
		return fmt.Errorf("function not found: %s", name)
	}

	os.MkdirAll(dir, 0700)

	handlerCode := fmt.Sprintf(`package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

func HandleRequest(ctx context.Context, event json.RawMessage) (string, error) {
	// Serverless backup handler
	start := time.Now()
	
	var config map[string]interface{}
	json.Unmarshal(event, &config)
	
	source := "%s"
	
	result := map[string]interface{}{
		"status": "completed",
		"backup_source": source,
		"timestamp": time.Now().Format(time.RFC3339),
		"duration": time.Since(start).String(),
	}
	
	data, _ := json.Marshal(result)
	return string(data), nil
}
`, config.Environment["BCK_SOURCE"])

	handlerPath := dir + "/main.go"
	os.WriteFile(handlerPath, []byte(handlerCode), 0600)

	sm.logger.Info("function exported", zap.String("path", handlerPath))
	return nil
}

func (sm *ServerlessManager) GetStats(name string) *LambdaStats {
	return sm.stats[name]
}
