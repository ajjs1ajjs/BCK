package security

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

type RansomwareIndicator struct {
	Severity string  // low, medium, high, critical
	Reason   string
	Score    float64 // 0-100
	Details  map[string]interface{}
}

type RansomwareDetector struct {
	watchPath    string
	baseline     map[string]baselineEntry
	honeypots    []string
	suspicious   map[string][]RansomwareIndicator
	mu           sync.RWMutex
	logger       *zap.Logger
	alertCh      chan RansomwareIndicator
}

type baselineEntry struct {
	Extension string
	AvgSize   int64
	Entropy   float64
	Count     int
}

type HoneypotFile struct {
	Path    string
	Content []byte
	Created time.Time
}

func NewRansomwareDetector(watchPath string, logger *zap.Logger) *RansomwareDetector {
	rd := &RansomwareDetector{
		watchPath:  watchPath,
		baseline:   make(map[string]baselineEntry),
		suspicious: make(map[string][]RansomwareIndicator),
		alertCh:    make(chan RansomwareIndicator, 100),
		logger:     logger,
	}
	rd.plantHoneypots()
	return rd
}

func (rd *RansomwareDetector) plantHoneypots() {
	// Plant decoy files that no legitimate process should modify
	rd.honeypots = []string{
		"_.backup_config.doc",
		"_.financial_data.xlsx",
		"_.passwords.kdbx",
		"_.database_dump.sql",
		"_.customer_records.csv",
	}

	for _, name := range rd.honeypots {
		path := filepath.Join(rd.watchPath, name)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			content := fmt.Sprintf("BCK-HONEYPOT-%d-%s", time.Now().UnixNano(), name)
			os.WriteFile(path, []byte(content), 0600)
			rd.logger.Info("honeypot planted", zap.String("path", path))
		}
	}
}

func (rd *RansomwareDetector) BuildBaseline() error {
	extCounts := make(map[string]int64)
	extSizes := make(map[string]int64)
	extCount := make(map[string]int)

	filepath.Walk(rd.watchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext == "" {
			ext = ".noext"
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		entropy := calculateEntropy(data)
		extCounts[ext] += int64(len(data))
		extSizes[ext] += info.Size()
		extCount[ext]++

		rd.mu.Lock()
		rd.baseline[ext] = baselineEntry{
			Extension: ext,
			AvgSize:   extSizes[ext] / int64(extCount[ext]),
			Entropy:   entropy,
			Count:     extCount[ext],
		}
		rd.mu.Unlock()

		return nil
	})

	rd.logger.Info("baseline built",
		zap.Int("extensions", len(rd.baseline)),
	)

	return nil
}

func calculateEntropy(data []byte) float64 {
	if len(data) == 0 {
		return 0
	}

	freq := make(map[byte]int)
	for _, b := range data {
		freq[b]++
	}

	var entropy float64
	for _, count := range freq {
		p := float64(count) / float64(len(data))
		entropy -= p * math.Log2(p)
	}
	return entropy
}

func (rd *RansomwareDetector) Scan() []RansomwareIndicator {
	var indicators []RansomwareIndicator

	rd.checkHoneypots(&indicators)
	rd.checkEntropyAnomalies(&indicators)
	rd.checkMassModifications(&indicators)
	rd.checkExtensionChanges(&indicators)

	rd.mu.Lock()
	for path, inds := range rd.suspicious {
		delete(rd.suspicious, path)
		for _, ind := range inds {
			indicators = append(indicators, ind)
			rd.logger.Warn("ransomware indicator",
				zap.String("reason", ind.Reason),
				zap.String("severity", ind.Severity),
				zap.Float64("score", ind.Score),
			)
		}
	}
	rd.mu.Unlock()

	return indicators
}

func (rd *RansomwareDetector) checkHoneypots(indicators *[]RansomwareIndicator) {
	for _, name := range rd.honeypots {
		path := filepath.Join(rd.watchPath, name)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}

		data, _ := os.ReadFile(path)
		entropy := calculateEntropy(data)

		if entropy > 7.0 {
			*indicators = append(*indicators, RansomwareIndicator{
				Severity: "critical",
				Reason:   fmt.Sprintf("Honeypot file %s has high entropy (%.2f) — possible encryption", name, entropy),
				Score:    95,
				Details: map[string]interface{}{
					"file":     path,
					"entropy":  entropy,
					"size":     info.Size(),
					"modified": info.ModTime().Format(time.RFC3339),
				},
			})
		}

		if info.Size() > 100 && entropy > 6.0 {
			*indicators = append(*indicators, RansomwareIndicator{
				Severity: "high",
				Reason:   fmt.Sprintf("Honeypot file %s was modified — ransomware activity suspected", name),
				Score:    85,
			})
		}
	}
}

func (rd *RansomwareDetector) checkEntropyAnomalies(indicators *[]RansomwareIndicator) {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	filepath.Walk(rd.watchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || info.Size() < 1024 {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if ext == "" {
			ext = ".noext"
		}

		baseline, exists := rd.baseline[ext]
		if !exists {
			return nil
		}

		data, _ := os.ReadFile(path)
		entropy := calculateEntropy(data)

		if entropy > baseline.Entropy+2.0 && entropy > 7.0 {
			*indicators = append(*indicators, RansomwareIndicator{
				Severity: "high",
				Reason:   fmt.Sprintf("High entropy anomaly for %s: %.2f (baseline: %.2f)", ext, entropy, baseline.Entropy),
				Score:    75,
				Details: map[string]interface{}{
					"file":     path,
					"entropy":  entropy,
					"baseline": baseline.Entropy,
				},
			})
		}

		return nil
	})
}

func (rd *RansomwareDetector) checkMassModifications(indicators *[]RansomwareIndicator) {
	recent := time.Now().Add(-5 * time.Minute)
	var modCount int
	var modFiles []string

	filepath.Walk(rd.watchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.ModTime().After(recent) && !strings.HasPrefix(filepath.Base(path), "_.") {
			modCount++
			if len(modFiles) < 10 {
				modFiles = append(modFiles, filepath.Base(path))
			}
		}
		return nil
	})

	if modCount > 100 {
		*indicators = append(*indicators, RansomwareIndicator{
			Severity: "critical",
			Reason:   fmt.Sprintf("Mass modification detected: %d files changed in 5 minutes", modCount),
			Score:    90,
			Details: map[string]interface{}{
				"count": modCount,
				"samples": modFiles,
			},
		})
	} else if modCount > 20 {
		*indicators = append(*indicators, RansomwareIndicator{
			Severity: "medium",
			Reason:   fmt.Sprintf("Unusual activity: %d files changed in 5 minutes", modCount),
			Score:    50,
		})
	}
}

func (rd *RansomwareDetector) checkExtensionChanges(indicators *[]RansomwareIndicator) {
	suspiciousExts := map[string]bool{
		".encrypted": true, ".locky": true, ".crypt": true,
		".crypted": true, ".locked": true, ".enc": true,
		".aaa": true, ".zzz": true, ".xxx": true, ".ttt": true,
		".micro": true, ".zepto": true, ".odin": true,
		".thor": true, ".cerber": true, ".lockbit": true,
	}

	var found []string
	filepath.Walk(rd.watchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if suspiciousExts[ext] {
			found = append(found, path)
		}
		return nil
	})

	if len(found) > 0 {
		*indicators = append(*indicators, RansomwareIndicator{
			Severity: "critical",
			Reason:   fmt.Sprintf("Suspicious file extensions found: %d files (%v)", len(found), found[:min(3, len(found))]),
			Score:    95,
			Details: map[string]interface{}{
				"count": len(found),
				"files": found[:min(5, len(found))],
			},
		})
	}
}

func (rd *RansomwareDetector) Quarantine(path string) error {
	quarantineDir := filepath.Join(filepath.Dir(rd.watchPath), ".bck-quarantine")
	os.MkdirAll(quarantineDir, 0700)

	dest := filepath.Join(quarantineDir, filepath.Base(path)+"."+time.Now().Format("20060102150405"))

	rd.logger.Warn("quarantining file", zap.String("source", path), zap.String("dest", dest))
	return os.Rename(path, dest)
}

func (rd *RansomwareDetector) AlertChannel() <-chan RansomwareIndicator {
	return rd.alertCh
}

func (rd *RansomwareDetector) Start(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			indicators := rd.Scan()
			for _, ind := range indicators {
				select {
				case rd.alertCh <- ind:
				default:
				}
			}
		}
	}
}
