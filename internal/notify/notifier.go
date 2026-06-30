package notify

import (
	"context"
	"fmt"
)

type Level string

const (
	LevelInfo    Level = "info"
	LevelWarning Level = "warning"
	LevelSuccess Level = "success"
	LevelError   Level = "error"
)

type Message struct {
	Title   string
	Body    string
	Level   Level
	Metadata map[string]string
}

type Notifier interface {
	Send(ctx context.Context, msg *Message) error
	Name() string
}

type Manager struct {
	notifiers []Notifier
}

func NewManager(notifiers ...Notifier) *Manager {
	return &Manager{notifiers: notifiers}
}

func (m *Manager) Send(ctx context.Context, msg *Message) error {
	var lastErr error
	for _, n := range m.notifiers {
		if err := n.Send(ctx, msg); err != nil {
			lastErr = fmt.Errorf("notifier %s: %w", n.Name(), err)
		}
	}
	return lastErr
}

func (m *Manager) Add(n Notifier) {
	m.notifiers = append(m.notifiers, n)
}

func (m *Manager) NotifyBackupSuccess(ctx context.Context, jobName, snapshotID string, fileCount, bytesProcessed int64) {
	m.Send(ctx, &Message{
		Title: fmt.Sprintf("Backup completed: %s", jobName),
		Body: fmt.Sprintf(
			"Job: %s\nSnapshot: %s\nFiles: %d\nSize: %d bytes",
			jobName, snapshotID, fileCount, bytesProcessed,
		),
		Level: LevelSuccess,
	})
}

func (m *Manager) NotifyBackupFailed(ctx context.Context, jobName string, err error) {
	m.Send(ctx, &Message{
		Title: fmt.Sprintf("Backup failed: %s", jobName),
		Body:  fmt.Sprintf("Job: %s\nError: %v", jobName, err),
		Level: LevelError,
	})
}
