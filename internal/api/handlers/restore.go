package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

type RestoreRequest struct {
	SnapshotID  string   `json:"snapshot_id" validate:"required"`
	TargetPath  string   `json:"target_path" validate:"required"`
	Files       []string `json:"files,omitempty"`
	Overwrite   bool     `json:"overwrite"`
}

type RestoreResponse struct {
	ID          string `json:"id"`
	SnapshotID  string `json:"snapshot_id"`
	TargetPath  string `json:"target_path"`
	Status      string `json:"status"`
	Progress    int    `json:"progress"`
	Message     string `json:"message,omitempty"`
}

func (h *Handler) StartRestore(w http.ResponseWriter, r *http.Request) {
	var req RestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.SnapshotID == "" || req.TargetPath == "" {
		respondError(w, http.StatusBadRequest, "snapshot_id and target_path are required")
		return
	}

	// Enqueue restore job
	err := h.redis.LPush(r.Context(), "bck:queue:restore",
		r.URL.Query().Get("job_id"),
	).Err()
	if err != nil {
		h.logger.Error("enqueue restore", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to enqueue restore")
		return
	}

	resp := RestoreResponse{
		ID:         "restore-" + req.SnapshotID,
		SnapshotID: req.SnapshotID,
		TargetPath: req.TargetPath,
		Status:     "queued",
	}

	respondJSON(w, http.StatusAccepted, resp)
}

func (h *Handler) GetRestoreStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	respondJSON(w, http.StatusOK, RestoreResponse{
		ID:     id,
		Status: "completed",
	})
}

func (h *Handler) ListSnapshots(w http.ResponseWriter, r *http.Request) {
	repoID := r.URL.Query().Get("repository_id")

	query := `SELECT id, repository_id, job_id,
	                 parent_snapshot_id, snapshot_path,
	                 total_size_bytes, file_count, chunk_count,
	                 tags, metadata, created_at
	          FROM snapshots`
	args := make([]interface{}, 0)

	if repoID != "" {
		query += " WHERE repository_id = $1"
		args = append(args, repoID)
	}
	query += " ORDER BY created_at DESC LIMIT 100"

	rows, err := h.db.Query(r.Context(), query, args...)
	if err != nil {
		h.logger.Error("list snapshots", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to list snapshots")
		return
	}
	defer rows.Close()

	type Snapshot struct {
		ID               string          `json:"id"`
		RepositoryID     string          `json:"repository_id"`
		JobID            *string         `json:"job_id,omitempty"`
		ParentSnapshotID *string         `json:"parent_snapshot_id,omitempty"`
		SnapshotPath     string          `json:"snapshot_path"`
		TotalSizeBytes   int64           `json:"total_size_bytes"`
		FileCount        int64           `json:"file_count"`
		ChunkCount       int64           `json:"chunk_count"`
		Tags             []string        `json:"tags,omitempty"`
		Metadata         json.RawMessage `json:"metadata,omitempty"`
		CreatedAt        string          `json:"created_at"`
	}

	snapshots := make([]Snapshot, 0)
	for rows.Next() {
		var s Snapshot
		var cr string
		err := rows.Scan(
			&s.ID, &s.RepositoryID, &s.JobID,
			&s.ParentSnapshotID, &s.SnapshotPath,
			&s.TotalSizeBytes, &s.FileCount, &s.ChunkCount,
			&s.Tags, &s.Metadata, &cr,
		)
		if err != nil {
			h.logger.Error("scan snapshot", zap.Error(err))
			continue
		}
		s.CreatedAt = cr
		snapshots = append(snapshots, s)
	}

	respondJSON(w, http.StatusOK, snapshots)
}

func (h *Handler) GetStats(w http.ResponseWriter, r *http.Request) {
	type Stats struct {
		TotalRepositories int64 `json:"total_repositories"`
		TotalJobs         int64 `json:"total_jobs"`
		ActiveJobs        int64 `json:"active_jobs"`
		TotalSnapshots    int64 `json:"total_snapshots"`
		TotalStorageBytes int64 `json:"total_storage_bytes"`
		RecentRuns        int64 `json:"recent_runs"`
	}

	stats := Stats{}

	h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM repositories`).Scan(&stats.TotalRepositories)
	h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM backup_jobs`).Scan(&stats.TotalJobs)
	h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM backup_jobs WHERE status = 'active'`).Scan(&stats.ActiveJobs)
	h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM snapshots`).Scan(&stats.TotalSnapshots)
	h.db.QueryRow(r.Context(), `SELECT COALESCE(SUM(total_size_bytes), 0) FROM repositories`).Scan(&stats.TotalStorageBytes)
	h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM job_runs WHERE created_at > NOW() - INTERVAL '24 hours'`).Scan(&stats.RecentRuns)

	respondJSON(w, http.StatusOK, stats)
}
