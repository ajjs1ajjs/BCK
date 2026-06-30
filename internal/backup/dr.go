package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"
)

type DRPlan struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	RPO         time.Duration `json:"rpo"` // Recovery Point Objective
	RTO         time.Duration `json:"rto"` // Recovery Time Objective
	RepositoryID string       `json:"repository_id"`
	Replicas    []ReplicaTarget `json:"replicas"`
	Enabled     bool          `json:"enabled"`
	CreatedAt   time.Time     `json:"created_at"`
}

type ReplicaTarget struct {
	Type        string `json:"type"` // s3, local, scp, rsync
	Endpoint    string `json:"endpoint"`
	Bucket      string `json:"bucket,omitempty"`
	Path        string `json:"path"`
	Credentials map[string]string `json:"credentials,omitempty"`
}

type DRManager struct {
	logger *zap.Logger
}

func NewDRManager(logger *zap.Logger) *DRManager {
	return &DRManager{logger: logger}
}

func (d *DRManager) CreatePlan(name, description, repoID string, rpo, rto time.Duration, replicas []ReplicaTarget) *DRPlan {
	return &DRPlan{
		ID:           fmt.Sprintf("dr-%d", time.Now().Unix()),
		Name:         name,
		Description:  description,
		RPO:          rpo,
		RTO:          rto,
		RepositoryID: repoID,
		Replicas:     replicas,
		Enabled:      true,
		CreatedAt:    time.Now(),
	}
}

func (d *DRManager) Replicate(ctx context.Context, plan *DRPlan, sourcePath string) error {
	if !plan.Enabled {
		return fmt.Errorf("DR plan %s is disabled", plan.Name)
	}

	d.logger.Info("starting disaster recovery replication",
		zap.String("plan", plan.Name),
		zap.String("source", sourcePath),
	)

	for _, replica := range plan.Replicas {
		d.logger.Info("replicating to target",
			zap.String("type", replica.Type),
			zap.String("endpoint", replica.Endpoint),
		)

		switch replica.Type {
		case "local":
			if err := d.replicateLocal(ctx, sourcePath, replica.Path); err != nil {
				d.logger.Error("local replication failed", zap.Error(err))
				return err
			}
		case "s3":
			if err := d.replicateS3(ctx, sourcePath, replica); err != nil {
				d.logger.Error("S3 replication failed", zap.Error(err))
				return err
			}
		case "scp":
			if err := d.replicateSCP(ctx, sourcePath, replica); err != nil {
				d.logger.Error("SCP replication failed", zap.Error(err))
				return err
			}
		default:
			d.logger.Warn("unknown replica type", zap.String("type", replica.Type))
		}
	}

	d.logger.Info("DR replication completed", zap.String("plan", plan.Name))
	return nil
}

func (d *DRManager) replicateLocal(ctx context.Context, source, target string) error {
	if err := os.MkdirAll(target, 0700); err != nil {
		return fmt.Errorf("create target dir: %w", err)
	}

	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, _ := filepath.Rel(source, path)
		targetPath := filepath.Join(target, relPath)

		if info.IsDir() {
			return os.MkdirAll(targetPath, info.Mode())
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read source: %w", err)
		}

		return os.WriteFile(targetPath, data, info.Mode())
	})
}

func (d *DRManager) replicateS3(ctx context.Context, sourcePath string, target ReplicaTarget) error {
	return fmt.Errorf("S3 replication requires AWS client")
}

func (d *DRManager) replicateSCP(ctx context.Context, sourcePath string, target ReplicaTarget) error {
	d.logger.Warn("SCP replication not yet implemented")
	return nil
}

func (d *DRManager) ValidateRPO(plan *DRPlan, lastBackupTime time.Time) (bool, time.Duration) {
	since := time.Since(lastBackupTime)
	return since <= plan.RPO, since
}

func (d *DRManager) EstimateRTO(dataSize int64, bandwidthMbps float64) time.Duration {
	if bandwidthMbps <= 0 {
		bandwidthMbps = 100 // assume 100 Mbps
	}
	bytesPerSec := bandwidthMbps * 1024 * 1024 / 8
	seconds := float64(dataSize) / bytesPerSec
	return time.Duration(seconds) * time.Second
}

func (d *DRManager) SavePlan(ctx context.Context, plan *DRPlan, path string) error {
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(path, plan.ID+".json"), data, 0600)
}

func (d *DRManager) LoadPlan(ctx context.Context, path string) (*DRPlan, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var plan DRPlan
	if err := json.Unmarshal(data, &plan); err != nil {
		return nil, err
	}
	return &plan, nil
}
