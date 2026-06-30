package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"go.uber.org/zap"
)

type Platform struct {
	OS   string `json:"os"`
	Arch string `json:"arch"`
}

type UpdateInfo struct {
	Version     string `json:"version"`
	URL         string `json:"url"`
	Checksum    string `json:"checksum"`
	ReleaseDate string `json:"release_date"`
	Changelog   string `json:"changelog"`
	Mandatory   bool   `json:"mandatory"`
}

type AutoUpdater struct {
	currentVersion string
	updateURL      string
	platform       Platform
	backupPath     string
	logger         *zap.Logger
}

func NewAutoUpdater(currentVersion, updateURL string, logger *zap.Logger) *AutoUpdater {
	return &AutoUpdater{
		currentVersion: currentVersion,
		updateURL:      updateURL,
		platform: Platform{
			OS:   runtime.GOOS,
			Arch: runtime.GOARCH,
		},
		logger: logger,
	}
}

func (a *AutoUpdater) CheckForUpdate() (*UpdateInfo, bool, error) {
	resp, err := http.Get(fmt.Sprintf("%s/latest?os=%s&arch=%s&current=%s",
		a.updateURL, a.platform.OS, a.platform.Arch, a.currentVersion))
	if err != nil {
		return nil, false, fmt.Errorf("check update: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil, false, nil
	}

	var update UpdateInfo
	if err := json.NewDecoder(resp.Body).Decode(&update); err != nil {
		return nil, false, fmt.Errorf("decode update: %w", err)
	}

	available := update.Version != a.currentVersion

	return &update, available, nil
}

func (a *AutoUpdater) DownloadUpdate(update *UpdateInfo) (string, error) {
	tmpFile := filepath.Join(os.TempDir(), fmt.Sprintf("bck-agent-%s", update.Version))
	if runtime.GOOS == "windows" {
		tmpFile += ".exe"
	}

	resp, err := http.Get(update.URL)
	if err != nil {
		return "", fmt.Errorf("download update: %w", err)
	}
	defer resp.Body.Close()

	f, err := os.Create(tmpFile)
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		return "", fmt.Errorf("write update: %w", err)
	}

	// Verify checksum
	f.Seek(0, 0)
	hash := sha256.New()
	io.Copy(hash, f)
	actualSum := hex.EncodeToString(hash.Sum(nil))

	if actualSum != update.Checksum {
		os.Remove(tmpFile)
		return "", fmt.Errorf("checksum mismatch: expected %s, got %s", update.Checksum, actualSum)
	}

	return tmpFile, nil
}

func (a *AutoUpdater) ApplyUpdate(binaryPath string) error {
	a.backupPath = binaryPath + ".backup"

	if err := os.Rename(binaryPath, a.backupPath); err != nil {
		return fmt.Errorf("backup binary: %w", err)
	}

	if err := os.Chmod(binaryPath, 0755); err != nil {
		return fmt.Errorf("chmod binary: %w", err)
	}

	// Restart the service
	if runtime.GOOS == "windows" {
		cmd := exec.Command("net", "stop", "bck-agent")
		cmd.Run()
		cmd = exec.Command("net", "start", "bck-agent")
		cmd.Run()
	} else {
		cmd := exec.Command("systemctl", "restart", "bck-agent")
		cmd.Run()
	}

	return nil
}

func (a *AutoUpdater) Rollback() error {
	if a.backupPath == "" {
		return fmt.Errorf("no backup available")
	}

	exePath, _ := os.Executable()
	os.Remove(exePath)
	if err := os.Rename(a.backupPath, exePath); err != nil {
		return fmt.Errorf("rollback: %w", err)
	}

	return nil
}

type AgentInfo struct {
	Version    string    `json:"version"`
	Platform   Platform  `json:"platform"`
	Hostname   string    `json:"hostname"`
	StartedAt  time.Time `json:"started_at"`
	Uptime     int64     `json:"uptime_seconds"`
	JobsDone   int64     `json:"jobs_done"`
	BytesSent  int64     `json:"bytes_sent"`
}

func GetAgentInfo(startedAt time.Time, jobsDone, bytesSent int64) *AgentInfo {
	hostname, _ := os.Hostname()
	return &AgentInfo{
		Version:  "2.0.0",
		Platform: Platform{OS: runtime.GOOS, Arch: runtime.GOARCH},
		Hostname: hostname,
		StartedAt: startedAt,
		Uptime:    int64(time.Since(startedAt).Seconds()),
		JobsDone:  jobsDone,
		BytesSent: bytesSent,
	}
}
