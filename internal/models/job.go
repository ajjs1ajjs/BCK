package models

import (
	"time"
)

type JobStatus string

const (
	JobStatusActive   JobStatus = "active"
	JobStatusPaused   JobStatus = "paused"
	JobStatusDisabled JobStatus = "disabled"
)

type JobRunStatus string

const (
	RunStatusPending   JobRunStatus = "pending"
	RunStatusRunning   JobRunStatus = "running"
	RunStatusSuccess   JobRunStatus = "success"
	RunStatusFailed    JobRunStatus = "failed"
	RunStatusCancelled JobRunStatus = "cancelled"
)

type BackupJob struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Description       string    `json:"description,omitempty"`
	SourcePath        string    `json:"source_path"`
	RepositoryID      string    `json:"repository_id"`
	CronExpression    string    `json:"cron_expression,omitempty"`
	ExcludePatterns   []string  `json:"exclude_patterns,omitempty"`
	Status            JobStatus `json:"status"`
	RetentionPolicyID *string   `json:"retention_policy_id,omitempty"`
	MaxRetries        int       `json:"max_retries"`
	TimeoutSeconds    int       `json:"timeout_seconds"`
	ChunkSizeBytes    int64     `json:"chunk_size_bytes"`
	CompressionLevel  int       `json:"compression_level"`
	NotifyOnSuccess   bool      `json:"notify_on_success"`
	NotifyOnFailure   bool      `json:"notify_on_failure"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type CreateJobRequest struct {
	Name              string   `json:"name" validate:"required,min=1,max=255"`
	Description       string   `json:"description,omitempty"`
	SourcePath        string   `json:"source_path" validate:"required"`
	RepositoryID      string   `json:"repository_id" validate:"required,uuid"`
	CronExpression    string   `json:"cron_expression,omitempty"`
	ExcludePatterns   []string `json:"exclude_patterns,omitempty"`
	RetentionPolicyID *string  `json:"retention_policy_id,omitempty"`
	MaxRetries        int      `json:"max_retries"`
	TimeoutSeconds    int      `json:"timeout_seconds"`
	ChunkSizeBytes    int64    `json:"chunk_size_bytes"`
	CompressionLevel  int      `json:"compression_level"`
	NotifyOnSuccess   bool     `json:"notify_on_success"`
	NotifyOnFailure   bool     `json:"notify_on_failure"`
}

type UpdateJobRequest struct {
	Name              *string  `json:"name,omitempty"`
	Description       *string  `json:"description,omitempty"`
	CronExpression    *string  `json:"cron_expression,omitempty"`
	ExcludePatterns   []string `json:"exclude_patterns,omitempty"`
	Status            *string  `json:"status,omitempty"`
	RetentionPolicyID *string  `json:"retention_policy_id,omitempty"`
	MaxRetries        *int     `json:"max_retries,omitempty"`
	TimeoutSeconds    *int     `json:"timeout_seconds,omitempty"`
	CompressionLevel  *int     `json:"compression_level,omitempty"`
	NotifyOnSuccess   *bool    `json:"notify_on_success,omitempty"`
	NotifyOnFailure   *bool    `json:"notify_on_failure,omitempty"`
}

type JobRun struct {
	ID              string       `json:"id"`
	JobID           string       `json:"job_id"`
	Status          JobRunStatus `json:"status"`
	SnapshotID      *string      `json:"snapshot_id,omitempty"`
	StartedAt       *time.Time    `json:"started_at,omitempty"`
	FinishedAt      *time.Time    `json:"finished_at,omitempty"`
	DurationSeconds float64      `json:"duration_seconds"`
	BytesProcessed  int64        `json:"bytes_processed"`
	BytesUploaded   int64        `json:"bytes_uploaded"`
	FilesProcessed  int64        `json:"files_processed"`
	FilesSkipped    int64        `json:"files_skipped"`
	ErrorMessage    string       `json:"error_message,omitempty"`
	LogOutput       string       `json:"log_output,omitempty"`
	RetryCount      int          `json:"retry_count"`
	CreatedAt       time.Time    `json:"created_at"`
}
