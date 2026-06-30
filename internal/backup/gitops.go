package backup

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

type BackupManifest struct {
	APIVersion string             `yaml:"apiVersion" json:"api_version"`
	Kind       string             `yaml:"kind" json:"kind"` // BackupPlan, RetentionPolicy, Repository
	Metadata   ManifestMetadata   `yaml:"metadata" json:"metadata"`
	Spec       ManifestSpec       `yaml:"spec" json:"spec"`
	Status     ManifestStatus     `yaml:"status,omitempty" json:"status,omitempty"`
}

type ManifestMetadata struct {
	Name        string            `yaml:"name" json:"name"`
	Namespace   string            `yaml:"namespace,omitempty" json:"namespace,omitempty"`
	Labels      map[string]string `yaml:"labels,omitempty" json:"labels,omitempty"`
	Annotations map[string]string `yaml:"annotations,omitempty" json:"annotations,omitempty"`
}

type ManifestSpec struct {
	// BackupPlan
	Source      string           `yaml:"source,omitempty" json:"source,omitempty"`
	Repository  string           `yaml:"repository,omitempty" json:"repository,omitempty"`
	Schedule    string           `yaml:"schedule,omitempty" json:"schedule,omitempty"`
	Retention   RetentionSpec    `yaml:"retention,omitempty" json:"retention,omitempty"`
	Encryption  EncryptionSpec   `yaml:"encryption,omitempty" json:"encryption,omitempty"`
	Compression CompressionSpec  `yaml:"compression,omitempty" json:"compression,omitempty"`
	Exclude     []string         `yaml:"exclude,omitempty" json:"exclude,omitempty"`
	Notifications []NotificationSpec `yaml:"notifications,omitempty" json:"notifications,omitempty"`

	// Repository
	StorageType string           `yaml:"storage_type,omitempty" json:"storage_type,omitempty"`
	Config      map[string]string `yaml:"config,omitempty" json:"config,omitempty"`

	// RetentionPolicy
	Rules       []RetentionRuleSpec `yaml:"rules,omitempty" json:"rules,omitempty"`
}

type RetentionSpec struct {
	Daily   int `yaml:"daily,omitempty" json:"daily,omitempty"`
	Weekly  int `yaml:"weekly,omitempty" json:"weekly,omitempty"`
	Monthly int `yaml:"monthly,omitempty" json:"monthly,omitempty"`
	Yearly  int `yaml:"yearly,omitempty" json:"yearly,omitempty"`
}

type EncryptionSpec struct {
	Algorithm string `yaml:"algorithm" json:"algorithm"` // aes-256-gcm, chacha20-poly1305, hybrid
	KeySource string `yaml:"key_source" json:"key_source"` // vault, local, kms
}

type CompressionSpec struct {
	Algorithm string `yaml:"algorithm" json:"algorithm"` // zstd, lz4, none
	Level     int    `yaml:"level" json:"level"`
}

type NotificationSpec struct {
	Type     string `yaml:"type" json:"type"` // email, telegram, webhook, slack
	OnSuccess bool  `yaml:"on_success" json:"on_success"`
	OnFailure bool  `yaml:"on_failure" json:"on_failure"`
	Config   map[string]string `yaml:"config,omitempty" json:"config,omitempty"`
}

type RetentionRuleSpec struct {
	Frequency string `yaml:"frequency" json:"frequency"`
	Keep      int    `yaml:"keep" json:"keep"`
}

type ManifestStatus struct {
	Phase      string    `yaml:"phase" json:"phase"` // pending, applied, failed, drifted
	AppliedAt  time.Time `yaml:"applied_at,omitempty" json:"applied_at,omitempty"`
	LastCheck  time.Time `yaml:"last_check,omitempty" json:"last_check,omitempty"`
	Drifted    bool      `yaml:"drifted" json:"drifted"`
	Message    string    `yaml:"message,omitempty" json:"message,omitempty"`
}

type DriftReport struct {
	ManifestName string   `yaml:"manifest_name" json:"manifest_name"`
	Drifted      bool     `yaml:"drifted" json:"drifted"`
	Changes      []string `yaml:"changes" json:"changes"`
}

type GitOpsEngine struct {
	manifests map[string]*BackupManifest
	logger    *zap.Logger
}

func NewGitOpsEngine(logger *zap.Logger) *GitOpsEngine {
	return &GitOpsEngine{
		manifests: make(map[string]*BackupManifest),
		logger:    logger,
	}
}

func (ge *GitOpsEngine) LoadManifest(path string) (*BackupManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}

	var manifest BackupManifest
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}

	manifest.Status.Phase = "loaded"
	manifest.Status.LastCheck = time.Now()

	ge.manifests[manifest.Metadata.Name] = &manifest

	ge.logger.Info("manifest loaded",
		zap.String("name", manifest.Metadata.Name),
		zap.String("kind", manifest.Kind),
	)

	return &manifest, nil
}

func (ge *GitOpsEngine) Apply(ctx context.Context, name string) error {
	manifest, exists := ge.manifests[name]
	if !exists {
		return fmt.Errorf("manifest not found: %s", name)
	}

	ge.logger.Info("applying manifest",
		zap.String("name", name),
		zap.String("kind", manifest.Kind),
	)

	switch manifest.Kind {
	case "BackupPlan":
		ge.applyBackupPlan(ctx, manifest)
	case "RetentionPolicy":
		ge.applyRetentionPolicy(ctx, manifest)
	case "Repository":
		ge.applyRepository(ctx, manifest)
	default:
		return fmt.Errorf("unknown kind: %s", manifest.Kind)
	}

	manifest.Status.Phase = "applied"
	manifest.Status.AppliedAt = time.Now()
	manifest.Status.Drifted = false

	return nil
}

func (ge *GitOpsEngine) applyBackupPlan(ctx context.Context, m *BackupManifest) {
	ge.logger.Info("applying backup plan",
		zap.String("source", m.Spec.Source),
		zap.String("repo", m.Spec.Repository),
		zap.String("schedule", m.Spec.Schedule),
	)
}

func (ge *GitOpsEngine) applyRetentionPolicy(ctx context.Context, m *BackupManifest) {
	ge.logger.Info("applying retention policy",
		zap.Int("daily", m.Spec.Retention.Daily),
		zap.Int("weekly", m.Spec.Retention.Weekly),
	)
}

func (ge *GitOpsEngine) applyRepository(ctx context.Context, m *BackupManifest) {
	ge.logger.Info("applying repository",
		zap.String("name", m.Metadata.Name),
		zap.String("type", m.Spec.StorageType),
	)
}

func (ge *GitOpsEngine) DetectDrift(name string) (*DriftReport, error) {
	manifest, exists := ge.manifests[name]
	if !exists {
		return nil, fmt.Errorf("manifest not found")
	}

	report := &DriftReport{
		ManifestName: name,
	}

	if manifest.Status.Phase == "applied" {
		report.Drifted = false
	} else {
		report.Drifted = true
		report.Changes = append(report.Changes, "manifest not in applied state")
	}

	manifest.Status.Drifted = report.Drifted
	manifest.Status.LastCheck = time.Now()

	return report, nil
}

func (ge *GitOpsEngine) Plan() []string {
	var plan []string
	for _, m := range ge.manifests {
		plan = append(plan, fmt.Sprintf("%s/%s: %s (%s)", m.Kind, m.Metadata.Name, m.Status.Phase, m.Spec.Source))
	}
	return plan
}

func (ge *GitOpsEngine) ExportManifests(dir string) error {
	os.MkdirAll(dir, 0700)
	for _, m := range ge.manifests {
		data, err := yaml.Marshal(m)
		if err != nil {
			return err
		}
		path := fmt.Sprintf("%s/%s.yaml", dir, m.Metadata.Name)
		if err := os.WriteFile(path, data, 0600); err != nil {
			return err
		}
	}
	return nil
}

func (ge *GitOpsEngine) Validate(m *BackupManifest) []string {
	var errors []string

	if m.APIVersion == "" {
		errors = append(errors, "apiVersion is required")
	}
	if m.Kind == "" {
		errors = append(errors, "kind is required")
	}
	if m.Metadata.Name == "" {
		errors = append(errors, "metadata.name is required")
	}

	switch m.Kind {
	case "BackupPlan":
		if m.Spec.Source == "" {
			errors = append(errors, "spec.source is required for BackupPlan")
		}
		if m.Spec.Repository == "" {
			errors = append(errors, "spec.repository is required for BackupPlan")
		}
	case "RetentionPolicy":
		if m.Spec.Retention.Daily == 0 && m.Spec.Retention.Weekly == 0 && m.Spec.Retention.Monthly == 0 {
			errors = append(errors, "at least one retention rule required")
		}
	}

	return errors
}

func MarshalManifest(m *BackupManifest) ([]byte, error) {
	return yaml.Marshal(m)
}
