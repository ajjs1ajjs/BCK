package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	BackupJobsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "backup_jobs_total",
			Help: "Total number of backup jobs by status",
		},
		[]string{"status"},
	)

	BackupDurationSeconds = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "backup_duration_seconds",
			Help:    "Backup job duration in seconds",
			Buckets: prometheus.ExponentialBuckets(1, 2, 16),
		},
	)

	BackupBytesProcessed = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "backup_bytes_processed_total",
			Help: "Total bytes processed by backup jobs",
		},
	)

	BackupBytesUploaded = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "backup_bytes_uploaded_total",
			Help: "Total bytes uploaded to backup repositories",
		},
	)

	BackupFilesProcessed = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "backup_files_processed_total",
			Help: "Total files processed by backup jobs",
		},
	)

	BackupCompressionRatio = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "backup_compression_ratio",
			Help:    "Backup compression ratio (compressed/uncompressed)",
			Buckets: prometheus.LinearBuckets(0.1, 0.1, 20),
		},
	)

	RestoreDurationSeconds = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "restore_duration_seconds",
			Help:    "Restore operation duration in seconds",
			Buckets: prometheus.ExponentialBuckets(1, 2, 16),
		},
	)

	RestoreBytesProcessed = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "restore_bytes_processed_total",
			Help: "Total bytes processed by restore operations",
		},
	)

	RepositorySizeBytes = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "repository_size_bytes",
			Help: "Current repository size in bytes",
		},
		[]string{"repository_id"},
	)

	RepositoryChunksTotal = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "repository_chunks_total",
			Help: "Current number of chunks in repository",
		},
		[]string{"repository_id"},
	)

	RepositorySnapshotsTotal = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "repository_snapshots_total",
			Help: "Current number of snapshots in repository",
		},
		[]string{"repository_id"},
	)

	APIRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "api_requests_total",
			Help: "Total API requests by method and path",
		},
		[]string{"method", "path", "status"},
	)

	APIRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "api_request_duration_seconds",
			Help:    "API request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "path"},
	)

	ActiveWorkers = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "active_workers",
			Help: "Current number of active worker goroutines",
		},
	)

	QueueLength = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "job_queue_length",
			Help: "Current number of jobs in queue",
		},
	)

	DBCOnnectionsOpen = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "db_connections_open",
			Help: "Number of open database connections",
		},
	)
)

func RecordBackupJob(status string) {
	BackupJobsTotal.WithLabelValues(status).Inc()
}

func RecordBackupDuration(duration float64) {
	BackupDurationSeconds.Observe(duration)
}

func RecordBackupBytes(bytes int64) {
	BackupBytesProcessed.Add(float64(bytes))
	BackupBytesUploaded.Add(float64(bytes))
}

func RecordBackupFiles(count int64) {
	BackupFilesProcessed.Add(float64(count))
}

func RecordRestoreDuration(duration float64) {
	RestoreDurationSeconds.Observe(duration)
}

func RecordRepositoryStats(repoID string, sizeBytes, chunks, snapshots int64) {
	RepositorySizeBytes.WithLabelValues(repoID).Set(float64(sizeBytes))
	RepositoryChunksTotal.WithLabelValues(repoID).Set(float64(chunks))
	RepositorySnapshotsTotal.WithLabelValues(repoID).Set(float64(snapshots))
}
