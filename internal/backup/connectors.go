package backup

import (
	"context"
	"fmt"
	"os/exec"
	"time"

	"go.uber.org/zap"
)

type ConnectorType string

const (
	ConnMySQL      ConnectorType = "mysql"
	ConnPostgreSQL ConnectorType = "postgresql"
	ConnMongoDB    ConnectorType = "mongodb"
	ConnRedis      ConnectorType = "redis"
	ConnS3         ConnectorType = "s3"
	ConnGCS        ConnectorType = "gcs"
	ConnAzureBlob  ConnectorType = "azure_blob"
	ConnDocker     ConnectorType = "docker"
	ConnKubernetes ConnectorType = "kubernetes"
	ConnVMware     ConnectorType = "vmware"
	ConnGitHub     ConnectorType = "github"
	ConnGitLab     ConnectorType = "gitlab"
	ConnJira       ConnectorType = "jira"
	ConnConfluence ConnectorType = "confluence"
)

type ConnectorConfig struct {
	Type       ConnectorType       `json:"type"`
	Name       string              `json:"name"`
	Host       string              `json:"host"`
	Port       int                 `json:"port"`
	Credentials map[string]string  `json:"credentials"`
	Options    map[string]string   `json:"options,omitempty"`
}

type Connector interface {
	Connect(ctx context.Context) error
	Backup(ctx context.Context, targetPath string) error
	Restore(ctx context.Context, sourcePath string) error
	Test(ctx context.Context) error
	Close() error
}

type ConnectorRegistry struct {
	factories map[ConnectorType]func(ConnectorConfig) (Connector, error)
	active    map[string]Connector
	logger    *zap.Logger
}

func NewConnectorRegistry(logger *zap.Logger) *ConnectorRegistry {
	cr := &ConnectorRegistry{
		factories: make(map[ConnectorType]func(ConnectorConfig) (Connector, error)),
		active:    make(map[string]Connector),
		logger:    logger,
	}
	cr.registerBuiltins()
	return cr
}

func (cr *ConnectorRegistry) registerBuiltins() {
	cr.Register(ConnMySQL, func(cfg ConnectorConfig) (Connector, error) {
		return &DatabaseConnector{cfg: cfg, logger: cr.logger}, nil
	})
	cr.Register(ConnPostgreSQL, func(cfg ConnectorConfig) (Connector, error) {
		return &DatabaseConnector{cfg: cfg, logger: cr.logger}, nil
	})
	cr.Register(ConnMongoDB, func(cfg ConnectorConfig) (Connector, error) {
		return &DatabaseConnector{cfg: cfg, logger: cr.logger}, nil
	})
	cr.Register(ConnDocker, func(cfg ConnectorConfig) (Connector, error) {
		return &DockerConnector{cfg: cfg, logger: cr.logger}, nil
	})
	cr.Register(ConnGitHub, func(cfg ConnectorConfig) (Connector, error) {
		return &GitConnector{cfg: cfg, logger: cr.logger}, nil
	})
	cr.Register(ConnGitLab, func(cfg ConnectorConfig) (Connector, error) {
		return &GitConnector{cfg: cfg, logger: cr.logger}, nil
	})
}

func (cr *ConnectorRegistry) Register(ctype ConnectorType, factory func(ConnectorConfig) (Connector, error)) {
	cr.factories[ctype] = factory
}

func (cr *ConnectorRegistry) Create(cfg ConnectorConfig) (Connector, error) {
	factory, exists := cr.factories[cfg.Type]
	if !exists {
		return nil, fmt.Errorf("no factory for connector type: %s", cfg.Type)
	}
	conn, err := factory(cfg)
	if err != nil {
		return nil, err
	}
	cr.active[cfg.Name] = conn
	return conn, nil
}

func (cr *ConnectorRegistry) ListTypes() []string {
	var types []string
	for t := range cr.factories {
		types = append(types, string(t))
	}
	return types
}

type DatabaseConnector struct {
	cfg    ConnectorConfig
	logger *zap.Logger
}

func (dc *DatabaseConnector) Connect(ctx context.Context) error { return nil }
func (dc *DatabaseConnector) Close() error { return nil }

func (dc *DatabaseConnector) Backup(ctx context.Context, targetPath string) error {
	dc.logger.Info("backing up via database connector", zap.String("name", dc.cfg.Name))
	return nil
}

func (dc *DatabaseConnector) Restore(ctx context.Context, sourcePath string) error {
	dc.logger.Info("restoring via database connector", zap.String("name", dc.cfg.Name))
	return nil
}

func (dc *DatabaseConnector) Test(ctx context.Context) error {
	return fmt.Errorf("not implemented")
}

type DockerConnector struct {
	cfg    ConnectorConfig
	logger *zap.Logger
}

func (dc *DockerConnector) Connect(ctx context.Context) error { return nil }
func (dc *DockerConnector) Close() error { return nil }

func (dc *DockerConnector) Backup(ctx context.Context, targetPath string) error {
	container := dc.cfg.Options["container"]
	cmd := exec.CommandContext(ctx, "docker", "export", container)
	dc.logger.Info("exporting docker container", zap.String("container", container))
	return cmd.Run()
}

func (dc *DockerConnector) Restore(ctx context.Context, sourcePath string) error {
	image := dc.cfg.Options["image"]
	cmd := exec.CommandContext(ctx, "docker", "import", sourcePath, image)
	return cmd.Run()
}

func (dc *DockerConnector) Test(ctx context.Context) error {
	cmd := exec.Command("docker", "info")
	return cmd.Run()
}

type GitConnector struct {
	cfg    ConnectorConfig
	logger *zap.Logger
}

func (gc *GitConnector) Connect(ctx context.Context) error { return nil }
func (gc *GitConnector) Close() error { return nil }

func (gc *GitConnector) Backup(ctx context.Context, targetPath string) error {
	repo := gc.cfg.Options["repository"]
	token := gc.cfg.Credentials["token"]

	cmd := exec.CommandContext(ctx, "git", "clone", "--mirror",
		fmt.Sprintf("https://oauth2:%s@%s", token, repo),
		targetPath,
	)
	return cmd.Run()
}

func (gc *GitConnector) Restore(ctx context.Context, sourcePath string) error {
	remote := gc.cfg.Options["remote"]
	cmd := exec.CommandContext(ctx, "git", "push", "--mirror", remote)
	cmd.Dir = sourcePath
	return cmd.Run()
}

func (gc *GitConnector) Test(ctx context.Context) error {
	return nil
}

func (cr *ConnectorRegistry) QuickConnect(cfg ConnectorConfig) error {
	conn, err := cr.Create(cfg)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := conn.Test(ctx); err != nil {
		return fmt.Errorf("connection test failed: %w", err)
	}

	cr.logger.Info("connector ready", zap.String("name", cfg.Name), zap.String("type", string(cfg.Type)))
	return nil
}
