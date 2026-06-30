package backup

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"go.uber.org/zap"
)

type DBType string

const (
	DBPostgreSQL DBType = "postgresql"
	DBMySQL      DBType = "mysql"
	DBMongoDB    DBType = "mongodb"
)

type DBBackupConfig struct {
	Type       DBType
	Host       string
	Port       int
	User       string
	Password   string
	Database   string
	OutputPath string
	ExtraArgs  []string
	Timeout    time.Duration
}

type DBBackupResult struct {
	DumpPath   string
	SizeBytes  int64
	Duration   time.Duration
	OutputLog  string
}

type DBDumper struct {
	logger *zap.Logger
}

func NewDBDumper(logger *zap.Logger) *DBDumper {
	return &DBDumper{logger: logger}
}

func (d *DBDumper) Dump(ctx context.Context, cfg *DBBackupConfig) (*DBBackupResult, error) {
	switch cfg.Type {
	case DBPostgreSQL:
		return d.dumpPostgres(ctx, cfg)
	case DBMySQL:
		return d.dumpMySQL(ctx, cfg)
	case DBMongoDB:
		return d.dumpMongo(ctx, cfg)
	default:
		return nil, fmt.Errorf("unsupported database type: %s", cfg.Type)
	}
}

func (d *DBDumper) dumpPostgres(ctx context.Context, cfg *DBBackupConfig) (*DBBackupResult, error) {
	outputFile := filepath.Join(cfg.OutputPath,
		fmt.Sprintf("pgdump_%s_%s.sql", cfg.Database, time.Now().Format("20060102_150405")))

	if err := os.MkdirAll(filepath.Dir(outputFile), 0700); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}

	args := []string{
		"-h", cfg.Host,
		"-p", fmt.Sprintf("%d", cfg.Port),
		"-U", cfg.User,
		"-d", cfg.Database,
		"-f", outputFile,
		"--no-owner",
		"--no-acl",
		"--clean",
		"--if-exists",
	}

	if cfg.Password != "" {
		os.Setenv("PGPASSWORD", cfg.Password)
		defer os.Unsetenv("PGPASSWORD")
	}

	args = append(args, cfg.ExtraArgs...)

	start := time.Now()

	cmd := exec.CommandContext(ctx, "pg_dump", args...)
	output, err := cmd.CombinedOutput()

	duration := time.Since(start)

	if err != nil {
		return nil, fmt.Errorf("pg_dump failed: %w\nOutput: %s", err, string(output))
	}

	info, err := os.Stat(outputFile)
	if err != nil {
		return nil, fmt.Errorf("stat dump file: %w", err)
	}

	d.logger.Info("PostgreSQL dump completed",
		zap.String("database", cfg.Database),
		zap.Int64("size", info.Size()),
		zap.Duration("duration", duration),
	)

	return &DBBackupResult{
		DumpPath:  outputFile,
		SizeBytes: info.Size(),
		Duration:  duration,
		OutputLog: string(output),
	}, nil
}

func (d *DBDumper) dumpMySQL(ctx context.Context, cfg *DBBackupConfig) (*DBBackupResult, error) {
	outputFile := filepath.Join(cfg.OutputPath,
		fmt.Sprintf("mysqldump_%s_%s.sql", cfg.Database, time.Now().Format("20060102_150405")))

	if err := os.MkdirAll(filepath.Dir(outputFile), 0700); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}

	args := []string{
		"-h", cfg.Host,
		"-P", fmt.Sprintf("%d", cfg.Port),
		"-u", cfg.User,
		"--single-transaction",
		"--routines",
		"--triggers",
		"--events",
		"--result-file=" + outputFile,
		cfg.Database,
	}

	if cfg.Password != "" {
		args = append([]string{"-p" + cfg.Password}, args...)
	}

	start := time.Now()

	cmd := exec.CommandContext(ctx, "mysqldump", args...)
	output, err := cmd.CombinedOutput()

	duration := time.Since(start)

	if err != nil {
		return nil, fmt.Errorf("mysqldump failed: %w\nOutput: %s", err, string(output))
	}

	info, err := os.Stat(outputFile)
	if err != nil {
		return nil, fmt.Errorf("stat dump file: %w", err)
	}

	d.logger.Info("MySQL dump completed",
		zap.String("database", cfg.Database),
		zap.Int64("size", info.Size()),
		zap.Duration("duration", duration),
	)

	return &DBBackupResult{
		DumpPath:  outputFile,
		SizeBytes: info.Size(),
		Duration:  duration,
		OutputLog: string(output),
	}, nil
}

func (d *DBDumper) dumpMongo(ctx context.Context, cfg *DBBackupConfig) (*DBBackupResult, error) {
	outputDir := filepath.Join(cfg.OutputPath,
		fmt.Sprintf("mongodump_%s_%s", cfg.Database, time.Now().Format("20060102_150405")))

	args := []string{
		"--host", cfg.Host,
		"--port", fmt.Sprintf("%d", cfg.Port),
		"--username", cfg.User,
		"--db", cfg.Database,
		"--out", outputDir,
		"--gzip",
	}

	if cfg.Password != "" {
		args = append(args, "--password", cfg.Password)
	}

	start := time.Now()

	cmd := exec.CommandContext(ctx, "mongodump", args...)
	output, err := cmd.CombinedOutput()

	duration := time.Since(start)

	if err != nil {
		return nil, fmt.Errorf("mongodump failed: %w\nOutput: %s", err, string(output))
	}

	d.logger.Info("MongoDB dump completed",
		zap.String("database", cfg.Database),
		zap.String("output", outputDir),
		zap.Duration("duration", duration),
	)

	return &DBBackupResult{
		DumpPath:  outputDir,
		Duration:  duration,
		OutputLog: string(output),
	}, nil
}

func (d *DBDumper) DumpToPipe(ctx context.Context, cfg *DBBackupConfig) (string, error) {
	switch cfg.Type {
	case DBPostgreSQL:
		args := []string{
			"-h", cfg.Host,
			"-p", fmt.Sprintf("%d", cfg.Port),
			"-U", cfg.User,
			"-d", cfg.Database,
			"--no-owner", "--no-acl", "--clean", "--if-exists",
		}
		if cfg.Password != "" {
			os.Setenv("PGPASSWORD", cfg.Password)
			defer os.Unsetenv("PGPASSWORD")
		}

		tmpFile := filepath.Join(cfg.OutputPath, fmt.Sprintf("dbpipe_%d.sql", time.Now().UnixNano()))
		cmd := exec.CommandContext(ctx, "pg_dump", args...)
		out, err := os.Create(tmpFile)
		if err != nil {
			return "", err
		}
		defer out.Close()
		cmd.Stdout = out

		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("pg_dump pipe: %w", err)
		}
		return tmpFile, nil

	case DBMySQL:
		args := []string{
			"-h", cfg.Host,
			"-P", fmt.Sprintf("%d", cfg.Port),
			"-u", cfg.User,
			"--single-transaction", "--routines", "--triggers",
			cfg.Database,
		}
		if cfg.Password != "" {
			args = append([]string{"-p" + cfg.Password}, args...)
		}

		tmpFile := filepath.Join(cfg.OutputPath, fmt.Sprintf("dbpipe_%d.sql", time.Now().UnixNano()))
		cmd := exec.CommandContext(ctx, "mysqldump", args...)
		out, err := os.Create(tmpFile)
		if err != nil {
			return "", err
		}
		defer out.Close()
		cmd.Stdout = out

		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("mysqldump pipe: %w", err)
		}
		return tmpFile, nil

	default:
		return "", fmt.Errorf("unsupported database type for pipe: %s", cfg.Type)
	}
}
