package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"time"

	"go.uber.org/zap"
)

type TwinNode struct {
	Name     string            `json:"name"`
	Type     string            `json:"type"` // repo, agent, server, storage
	Status   string            `json:"status"`
	Health   float64           `json:"health"` // 0-100
	Metrics  map[string]float64 `json:"metrics"`
	Children []*TwinNode       `json:"children,omitempty"`
}

type SimulationScenario struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Event       string            `json:"event"` // disk_failure, network_outage, ransomware, region_loss
	Parameters  map[string]float64 `json:"parameters"`
}

type SimulationResult struct {
	Scenario      string        `json:"scenario"`
	Duration      time.Duration `json:"duration"`
	RPO           time.Duration `json:"rpo"`
	RTO           time.Duration `json:"rto"`
	DataLoss      int64         `json:"data_loss_bytes"`
	SuccessRate   float64       `json:"success_rate"`
	Recovered     bool          `json:"recovered"`
	Recommendations []string    `json:"recommendations,omitempty"`
}

type DigitalTwin struct {
	nodes       map[string]*TwinNode
	scenarios   []SimulationScenario
	history     []SimulationResult
	logger      *zap.Logger
}

func NewDigitalTwin(logger *zap.Logger) *DigitalTwin {
	dt := &DigitalTwin{
		nodes:  make(map[string]*TwinNode),
		logger: logger,
	}
	dt.registerScenarios()
	return dt
}

func (dt *DigitalTwin) registerScenarios() {
	dt.scenarios = []SimulationScenario{
		{
			Name:        "primary_disk_failure",
			Description: "Primary storage disk fails. Can we recover from backup?",
			Event:       "disk_failure",
			Parameters:  map[string]float64{"failure_percent": 100},
		},
		{
			Name:        "ransomware_attack",
			Description: "Ransomware encrypts 80% of files. How fast can we detect and recover?",
			Event:       "ransomware",
			Parameters:  map[string]float64{"encrypted_percent": 80},
		},
		{
			Name:        "network_partition",
			Description: "Network partition between primary and DR site",
			Event:       "network_outage",
			Parameters:  map[string]float64{"duration_hours": 4},
		},
		{
			Name:        "full_region_loss",
			Description: "Complete loss of primary region",
			Event:       "region_loss",
			Parameters:  map[string]float64{"recovery_time_hours": 8},
		},
		{
			Name:        "data_corruption",
			Description: "Silent data corruption in 5% of chunks",
			Event:       "disk_failure",
			Parameters:  map[string]float64{"corrupted_chunks": 5},
		},
	}
}

func (dt *DigitalTwin) AddNode(node *TwinNode) {
	dt.nodes[node.Name] = node
}

func (dt *DigitalTwin) RunSimulation(ctx context.Context, scenarioName string) (*SimulationResult, error) {
	var scenario *SimulationScenario
	for i := range dt.scenarios {
		if dt.scenarios[i].Name == scenarioName {
			scenario = &dt.scenarios[i]
			break
		}
	}
	if scenario == nil {
		return nil, fmt.Errorf("scenario not found: %s", scenarioName)
	}

	dt.logger.Info("running simulation", zap.String("scenario", scenario.Name))

	start := time.Now()

	result := &SimulationResult{
		Scenario: scenario.Name,
	}

	switch scenario.Event {
	case "disk_failure":
		result = dt.simulateDiskFailure(scenario)
	case "ransomware":
		result = dt.simulateRansomware(scenario)
	case "network_outage":
		result = dt.simulateNetworkOutage(scenario)
	case "region_loss":
		result = dt.simulateRegionLoss(scenario)
	}

	result.Duration = time.Since(start)

	dt.history = append(dt.history, *result)

	dt.logger.Info("simulation completed",
		zap.String("scenario", scenario.Name),
		zap.Bool("recovered", result.Recovered),
		zap.Duration("rpo", result.RPO),
		zap.Duration("rto", result.RTO),
	)

	return result, nil
}

func (dt *DigitalTwin) simulateDiskFailure(scenario *SimulationScenario) *SimulationResult {
	result := &SimulationResult{Recovered: true}

	drDuration := time.Duration(rand.Intn(60)+30) * time.Minute
	result.RTO = drDuration
	result.RPO = 5 * time.Minute
	result.DataLoss = int64(rand.Intn(100)) * 1024 * 1024
	result.SuccessRate = 95 + rand.Float64()*5
	result.Recommendations = []string{
		"Consider RAID6 for primary storage",
		"Increase snapshot frequency for critical data",
	}
	return result
}

func (dt *DigitalTwin) simulateRansomware(scenario *SimulationScenario) *SimulationResult {
	result := &SimulationResult{Recovered: true}

	result.RTO = time.Duration(rand.Intn(120)+30) * time.Minute
	result.RPO = 15 * time.Minute
	result.DataLoss = int64(rand.Intn(500)) * 1024 * 1024

	detected := rand.Float64() < 0.9
	if !detected {
		result.Recovered = false
		result.SuccessRate = 70
		result.Recommendations = []string{
			"Enable honeypot file monitoring",
			"Reduce ransomware detection scan interval",
			"Ensure immutable backups are enabled",
		}
	} else {
		result.SuccessRate = 98
		result.Recommendations = []string{
			"Ransomware detection working correctly",
			"Continue regular immutable backup validation",
		}
	}
	return result
}

func (dt *DigitalTwin) simulateNetworkOutage(scenario *SimulationScenario) *SimulationResult {
	result := &SimulationResult{Recovered: true}
	result.RTO = time.Duration(rand.Intn(30)+10) * time.Minute
	result.RPO = 0
	result.SuccessRate = 88
	result.Recommendations = []string{
		"Set up redundant network paths",
		"Configure automatic failover between regions",
	}
	return result
}

func (dt *DigitalTwin) simulateRegionLoss(scenario *SimulationScenario) *SimulationResult {
	result := &SimulationResult{Recovered: true}
	result.RTO = time.Duration(rand.Intn(480)+60) * time.Minute
	result.RPO = time.Duration(rand.Intn(60)+5) * time.Minute
	result.DataLoss = int64(rand.Intn(10000)) * 1024 * 1024
	result.SuccessRate = 82
	result.Recommendations = []string{
		"Increase cross-region replication frequency",
		"Test DR plan quarterly",
		"Ensure DNS failover is configured",
	}
	return result
}

func (dt *DigitalTwin) GetScenarioReport() map[string]interface{} {
	report := map[string]interface{}{
		"scenarios_run": len(dt.history),
		"scenarios":     make([]map[string]interface{}, 0),
	}

	for _, r := range dt.history {
		report["scenarios"] = append(report["scenarios"].([]map[string]interface{}), map[string]interface{}{
			"name":         r.Scenario,
			"recovered":    r.Recovered,
			"rpo_seconds":  r.RPO.Seconds(),
			"rto_seconds":  r.RTO.Seconds(),
			"success_rate": r.SuccessRate,
		})
	}

	return report
}

func (dt *DigitalTwin) ExportReport(path string) error {
	report := dt.GetScenarioReport()
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func (dt *DigitalTwin) CapacityPlanning(dailyGrowthGB float64, months int) map[string]float64 {
	plan := make(map[string]float64)

	currentTB := dailyGrowthGB * 30 * float64(months) / 1024
	plan["total_projected_tb"] = currentTB
	plan["recommended_storage_tb"] = currentTB * 1.3
	plan["hot_tier_tb"] = currentTB * 0.2
	plan["cold_tier_tb"] = currentTB * 0.5
	plan["glacier_tier_tb"] = currentTB * 0.3
	plan["monthly_cost_estimate"] = currentTB * 23.0 // ~$23/TB/month

	return plan
}
