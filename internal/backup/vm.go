package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"
)

type VMType string

const (
	VMVMware  VMType = "vmware"
	VMHyperV  VMType = "hyperv"
	VMKVM     VMType = "kvm"
	VMProxmox VMType = "proxmox"
)

type VMConfig struct {
	Type        VMType   `json:"type"`
	Host        string   `json:"host"`
	Username    string   `json:"username"`
	Password    string   `json:"password"`
	Datacenter  string   `json:"datacenter,omitempty"`
	Cluster     string   `json:"cluster,omitempty"`
	Datastore   string   `json:"datastore,omitempty"`
	VMName      string   `json:"vm_name"`
	Snapshot    bool     `json:"snapshot"`     // Create VM snapshot before backup
	Quiesce     bool     `json:"quiesce"`      // Quiesce filesystem
	ExcludeDisks []int   `json:"exclude_disks,omitempty"`
	OutputPath  string   `json:"output_path"`
	Compress    bool     `json:"compress"`
}

type VMBackupResult struct {
	VMName      string        `json:"vm_name"`
	BackupPath  string        `json:"backup_path"`
	SizeBytes   int64         `json:"size_bytes"`
	Duration    time.Duration `json:"duration"`
	Snapshots   []VMDiskSnapshot `json:"snapshots,omitempty"`
}

type VMDiskSnapshot struct {
	DiskID    int    `json:"disk_id"`
	Label     string `json:"label"`
	SizeBytes int64  `json:"size_bytes"`
	Path      string `json:"path"`
}

type VMBackupEngine struct {
	logger *zap.Logger
}

func NewVMBackupEngine(logger *zap.Logger) *VMBackupEngine {
	return &VMBackupEngine{logger: logger}
}

func (v *VMBackupEngine) Backup(ctx context.Context, cfg *VMConfig) (*VMBackupResult, error) {
	switch cfg.Type {
	case VMVMware:
		return v.backupVMware(ctx, cfg)
	case VMHyperV:
		return v.backupHyperV(ctx, cfg)
	default:
		return nil, fmt.Errorf("unsupported VM type: %s", cfg.Type)
	}
}

func (v *VMBackupEngine) backupVMware(ctx context.Context, cfg *VMConfig) (*VMBackupResult, error) {
	if err := os.MkdirAll(cfg.OutputPath, 0700); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}

	if cfg.Snapshot {
		v.logger.Info("creating VMware snapshot",
			zap.String("vm", cfg.VMName),
			zap.Bool("quiesce", cfg.Quiesce),
		)

		quiesceFlag := "0"
		if cfg.Quiesce {
			quiesceFlag = "1"
		}

		snapName := fmt.Sprintf("bck-%s", time.Now().Format("20060102-150405"))

		cmd := exec.CommandContext(ctx, "vmware-vmbackup",
			"-h", cfg.Host,
			"-u", cfg.Username,
			"-p", cfg.Password,
			"-s", snapName,
			"-q", quiesceFlag,
			"-m", cfg.VMName,
		)
		output, err := cmd.CombinedOutput()
		if err != nil {
			v.logger.Warn("VMware snapshot failed (may need vCenter tools installed)",
				zap.Error(err),
				zap.String("output", string(output)),
			)
		} else {
			v.logger.Info("VMware snapshot created", zap.String("name", snapName))
		}
	}

	backupFile := filepath.Join(cfg.OutputPath,
		fmt.Sprintf("%s_%s.ova", strings.ReplaceAll(cfg.VMName, " ", "_"),
			time.Now().Format("20060102-150405")))

	cmd := exec.CommandContext(ctx, "ovftool",
		fmt.Sprintf("vi://%s:%s@%s/%s/host/%s/%s?ds=[%s]",
			cfg.Username, cfg.Password,
			cfg.Host,
			cfg.Datacenter, cfg.Cluster,
			cfg.VMName, cfg.Datastore,
		),
		backupFile,
	)

	start := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(start)

	if err != nil {
		return nil, fmt.Errorf("ovftool export failed: %w\nOutput: %s", err, string(output))
	}

	info, _ := os.Stat(backupFile)
	size := int64(0)
	if info != nil {
		size = info.Size()
	}

	v.logger.Info("VMware VM backup completed",
		zap.String("vm", cfg.VMName),
		zap.Int64("size", size),
		zap.Duration("duration", duration),
	)

	return &VMBackupResult{
		VMName:     cfg.VMName,
		BackupPath: backupFile,
		SizeBytes:  size,
		Duration:   duration,
	}, nil
}

func (v *VMBackupEngine) backupHyperV(ctx context.Context, cfg *VMConfig) (*VMBackupResult, error) {
	if err := os.MkdirAll(cfg.OutputPath, 0700); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}

	if cfg.Snapshot {
		v.logger.Info("creating Hyper-V checkpoint", zap.String("vm", cfg.VMName))

		cmd := exec.CommandContext(ctx, "powershell",
			"-Command",
			fmt.Sprintf(`Checkpoint-VM -Name "%s" -SnapshotName "BCK-%s"`,
				cfg.VMName, time.Now().Format("20060102-150405")),
		)
		output, err := cmd.CombinedOutput()
		if err != nil {
			v.logger.Warn("Hyper-V checkpoint failed", zap.Error(err), zap.String("output", string(output)))
		}
	}

	backupFile := filepath.Join(cfg.OutputPath,
		fmt.Sprintf("%s_%s.vhdx", strings.ReplaceAll(cfg.VMName, " ", "_"),
			time.Now().Format("20060102-150405")))

	cmd := exec.CommandContext(ctx, "powershell",
		"-Command",
		fmt.Sprintf(`Export-VM -Name "%s" -Path "%s"`,
			cfg.VMName, cfg.OutputPath),
	)

	start := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(start)

	if err != nil {
		return nil, fmt.Errorf("Hyper-V export failed: %w\nOutput: %s", err, string(output))
	}

	size := dirSize(cfg.OutputPath)

	v.logger.Info("Hyper-V VM backup completed",
		zap.String("vm", cfg.VMName),
		zap.Int64("size", size),
		zap.Duration("duration", duration),
	)

	return &VMBackupResult{
		VMName:     cfg.VMName,
		BackupPath: backupFile,
		SizeBytes:  size,
		Duration:   duration,
	}, nil
}

func (v *VMBackupEngine) Restore(ctx context.Context, backupPath, targetHost, targetName string) error {
	v.logger.Info("starting VM restore",
		zap.String("backup", backupPath),
		zap.String("target", targetName),
	)

	_, err := os.Stat(backupPath)
	if err != nil {
		return fmt.Errorf("backup file not found: %w", err)
	}

	// OVF/OVA restore via ovftool
	cmd := exec.CommandContext(ctx, "ovftool",
		"--name="+targetName,
		"--datastore=datastore1",
		backupPath,
		fmt.Sprintf("vi://%s:****@%s", targetHost, targetHost),
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("VM restore failed: %w\nOutput: %s", err, string(output))
	}

	v.logger.Info("VM restored successfully", zap.String("vm", targetName))
	return nil
}

func (v *VMBackupEngine) ListVMs(ctx context.Context, host, username, password string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "powershell",
		"-Command",
		"Get-VM | Select-Object -ExpandProperty Name",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("list VMs: %w", err)
	}

	vms := strings.Split(strings.TrimSpace(string(output)), "\n")
	result := make([]string, 0, len(vms))
	for _, vm := range vms {
		vm = strings.TrimSpace(vm)
		if vm != "" {
			result = append(result, vm)
		}
	}
	return result, nil
}

func (v *VMBackupEngine) GetVMSize(vmPath string) (int64, error) {
	return dirSize(vmPath), nil
}

func dirSize(path string) int64 {
	var size int64
	filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size
}

type VMManifest struct {
	VMName      string            `json:"vm_name"`
	BackupDate  time.Time         `json:"backup_date"`
	VMType      VMType            `json:"vm_type"`
	Disks       []VMDiskSnapshot  `json:"disks"`
	Config      json.RawMessage   `json:"config"`
	Checksum    string            `json:"checksum"`
}

func (v *VMBackupEngine) CreateManifest(cfg *VMConfig, result *VMBackupResult) (*VMManifest, error) {
	manifest := &VMManifest{
		VMName:     cfg.VMName,
		BackupDate: time.Now(),
		VMType:     cfg.Type,
	}

	data, _ := json.MarshalIndent(manifest, "", "  ")

	manifestPath := filepath.Join(cfg.OutputPath, "manifest.json")
	if err := os.WriteFile(manifestPath, data, 0600); err != nil {
		return nil, fmt.Errorf("write manifest: %w", err)
	}

	return manifest, nil
}
