package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ajjs1ajjs/BCK/internal/models"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func (h *Handler) ListJobs(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(),
		`SELECT id, name, description, source_path, repository_id,
		        cron_expression, exclude_patterns, status,
		        retention_policy_id, max_retries, timeout_seconds,
		        chunk_size_bytes, compression_level,
		        notify_on_success, notify_on_failure,
		        created_at, updated_at
		 FROM backup_jobs ORDER BY created_at DESC`,
	)
	if err != nil {
		h.logger.Error("list jobs", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to list jobs")
		return
	}
	defer rows.Close()

	jobs := make([]models.BackupJob, 0)
	for rows.Next() {
		var j models.BackupJob
		err := rows.Scan(
			&j.ID, &j.Name, &j.Description, &j.SourcePath, &j.RepositoryID,
			&j.CronExpression, &j.ExcludePatterns, &j.Status,
			&j.RetentionPolicyID, &j.MaxRetries, &j.TimeoutSeconds,
			&j.ChunkSizeBytes, &j.CompressionLevel,
			&j.NotifyOnSuccess, &j.NotifyOnFailure,
			&j.CreatedAt, &j.UpdatedAt,
		)
		if err != nil {
			h.logger.Error("scan job", zap.Error(err))
			continue
		}
		jobs = append(jobs, j)
	}

	respondJSON(w, http.StatusOK, jobs)
}

func (h *Handler) CreateJob(w http.ResponseWriter, r *http.Request) {
	var req models.CreateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.SourcePath == "" || req.RepositoryID == "" {
		respondError(w, http.StatusBadRequest, "source_path and repository_id are required")
		return
	}

	if req.MaxRetries == 0 {
		req.MaxRetries = 3
	}
	if req.TimeoutSeconds == 0 {
		req.TimeoutSeconds = 3600
	}
	if req.ChunkSizeBytes == 0 {
		req.ChunkSizeBytes = 4194304
	}
	if req.CompressionLevel == 0 {
		req.CompressionLevel = 3
	}

	var job models.BackupJob
	err := h.db.QueryRow(r.Context(),
		`INSERT INTO backup_jobs (
			name, description, source_path, repository_id,
			cron_expression, exclude_patterns,
			retention_policy_id, max_retries, timeout_seconds,
			chunk_size_bytes, compression_level,
			notify_on_success, notify_on_failure
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING id, name, description, source_path, repository_id,
		          cron_expression, exclude_patterns, status,
		          retention_policy_id, max_retries, timeout_seconds,
		          chunk_size_bytes, compression_level,
		          notify_on_success, notify_on_failure,
		          created_at, updated_at`,
		req.Name, req.Description, req.SourcePath, req.RepositoryID,
		req.CronExpression, req.ExcludePatterns,
		req.RetentionPolicyID, req.MaxRetries, req.TimeoutSeconds,
		req.ChunkSizeBytes, req.CompressionLevel,
		req.NotifyOnSuccess, req.NotifyOnFailure,
	).Scan(
		&job.ID, &job.Name, &job.Description, &job.SourcePath, &job.RepositoryID,
		&job.CronExpression, &job.ExcludePatterns, &job.Status,
		&job.RetentionPolicyID, &job.MaxRetries, &job.TimeoutSeconds,
		&job.ChunkSizeBytes, &job.CompressionLevel,
		&job.NotifyOnSuccess, &job.NotifyOnFailure,
		&job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		h.logger.Error("create job", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to create job")
		return
	}

	respondJSON(w, http.StatusCreated, job)
}

func (h *Handler) GetJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var j models.BackupJob
	err := h.db.QueryRow(r.Context(),
		`SELECT id, name, description, source_path, repository_id,
		        cron_expression, exclude_patterns, status,
		        retention_policy_id, max_retries, timeout_seconds,
		        chunk_size_bytes, compression_level,
		        notify_on_success, notify_on_failure,
		        created_at, updated_at
		 FROM backup_jobs WHERE id = $1`, id,
	).Scan(
		&j.ID, &j.Name, &j.Description, &j.SourcePath, &j.RepositoryID,
		&j.CronExpression, &j.ExcludePatterns, &j.Status,
		&j.RetentionPolicyID, &j.MaxRetries, &j.TimeoutSeconds,
		&j.ChunkSizeBytes, &j.CompressionLevel,
		&j.NotifyOnSuccess, &j.NotifyOnFailure,
		&j.CreatedAt, &j.UpdatedAt,
	)
	if err != nil {
		respondError(w, http.StatusNotFound, "job not found")
		return
	}

	respondJSON(w, http.StatusOK, j)
}

func (h *Handler) UpdateJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.UpdateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var j models.BackupJob
	err := h.db.QueryRow(r.Context(),
		`UPDATE backup_jobs SET
			name = COALESCE($2, name),
			description = COALESCE($3, description),
			cron_expression = COALESCE($4, cron_expression),
			exclude_patterns = COALESCE($5, exclude_patterns),
			status = COALESCE($6::job_status, status),
			retention_policy_id = COALESCE($7, retention_policy_id),
			max_retries = COALESCE($8, max_retries),
			timeout_seconds = COALESCE($9, timeout_seconds),
			compression_level = COALESCE($10, compression_level),
			notify_on_success = COALESCE($11, notify_on_success),
			notify_on_failure = COALESCE($12, notify_on_failure),
			updated_at = NOW()
		WHERE id = $1
		RETURNING id, name, description, source_path, repository_id,
		          cron_expression, exclude_patterns, status,
		          retention_policy_id, max_retries, timeout_seconds,
		          chunk_size_bytes, compression_level,
		          notify_on_success, notify_on_failure,
		          created_at, updated_at`,
		id, req.Name, req.Description, req.CronExpression,
		req.ExcludePatterns, req.Status, req.RetentionPolicyID,
		req.MaxRetries, req.TimeoutSeconds, req.CompressionLevel,
		req.NotifyOnSuccess, req.NotifyOnFailure,
	).Scan(
		&j.ID, &j.Name, &j.Description, &j.SourcePath, &j.RepositoryID,
		&j.CronExpression, &j.ExcludePatterns, &j.Status,
		&j.RetentionPolicyID, &j.MaxRetries, &j.TimeoutSeconds,
		&j.ChunkSizeBytes, &j.CompressionLevel,
		&j.NotifyOnSuccess, &j.NotifyOnFailure,
		&j.CreatedAt, &j.UpdatedAt,
	)
	if err != nil {
		h.logger.Error("update job", zap.Error(err))
		respondError(w, http.StatusNotFound, "job not found")
		return
	}

	respondJSON(w, http.StatusOK, j)
}

func (h *Handler) DeleteJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	_, err := h.db.Exec(r.Context(),
		`DELETE FROM backup_jobs WHERE id = $1`, id,
	)
	if err != nil {
		respondError(w, http.StatusNotFound, "job not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) RunJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Enqueue job to Redis
	err := h.redis.LPush(r.Context(), "bck:queue:jobs", id).Err()
	if err != nil {
		h.logger.Error("enqueue job", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to enqueue job")
		return
	}

	// Create a job_run record
	var run models.JobRun
	err = h.db.QueryRow(r.Context(),
		`INSERT INTO job_runs (job_id, status)
		 VALUES ($1, 'pending')
		 RETURNING id, job_id, status, created_at`,
		id,
	).Scan(&run.ID, &run.JobID, &run.Status, &run.CreatedAt)
	if err != nil {
		h.logger.Error("create run", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to create run record")
		return
	}

	respondJSON(w, http.StatusAccepted, run)
}

func (h *Handler) ListJobRuns(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	rows, err := h.db.Query(r.Context(),
		`SELECT id, job_id, status, snapshot_id,
		        started_at, finished_at, duration_seconds,
		        bytes_processed, bytes_uploaded,
		        files_processed, files_skipped,
		        error_message, retry_count, created_at
		 FROM job_runs WHERE job_id = $1
		 ORDER BY created_at DESC LIMIT 50`, id,
	)
	if err != nil {
		h.logger.Error("list runs", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to list runs")
		return
	}
	defer rows.Close()

	runs := make([]models.JobRun, 0)
	for rows.Next() {
		var run models.JobRun
		err := rows.Scan(
			&run.ID, &run.JobID, &run.Status, &run.SnapshotID,
			&run.StartedAt, &run.FinishedAt, &run.DurationSeconds,
			&run.BytesProcessed, &run.BytesUploaded,
			&run.FilesProcessed, &run.FilesSkipped,
			&run.ErrorMessage, &run.RetryCount, &run.CreatedAt,
		)
		if err != nil {
			h.logger.Error("scan run", zap.Error(err))
			continue
		}
		runs = append(runs, run)
	}

	respondJSON(w, http.StatusOK, runs)
}
