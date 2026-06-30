package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ajjs1ajjs/BCK/internal/models"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func (h *Handler) ListRepositories(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(),
		`SELECT id, name, description, storage_type,
		        storage_config, encryption_key_id, compression,
		        status, total_size_bytes, total_chunks,
		        total_snapshots, created_at, updated_at
		 FROM repositories ORDER BY created_at DESC`,
	)
	if err != nil {
		h.logger.Error("list repos", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to list repositories")
		return
	}
	defer rows.Close()

	repos := make([]models.Repository, 0)
	for rows.Next() {
		var r models.Repository
		err := rows.Scan(
			&r.ID, &r.Name, &r.Description, &r.StorageType,
			&r.StorageConfig, &r.EncryptionKeyID, &r.Compression,
			&r.Status, &r.TotalSizeBytes, &r.TotalChunks,
			&r.TotalSnapshots, &r.CreatedAt, &r.UpdatedAt,
		)
		if err != nil {
			h.logger.Error("scan repo", zap.Error(err))
			continue
		}
		repos = append(repos, r)
	}

	respondJSON(w, http.StatusOK, repos)
}

func (h *Handler) CreateRepository(w http.ResponseWriter, r *http.Request) {
	var req models.CreateRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.StorageType == "" {
		req.StorageType = "local"
	}

	cfg := json.RawMessage(`{}`)
	if req.StorageType == "local" {
		cfg = json.RawMessage(`{"path":"/var/lib/backupmanager/repos"}`)
	}

	var repo models.Repository
	err := h.db.QueryRow(r.Context(),
		`INSERT INTO repositories (name, description, storage_type, storage_config)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, description, storage_type,
		           storage_config, encryption_key_id, compression,
		           status, total_size_bytes, total_chunks,
		           total_snapshots, created_at, updated_at`,
		req.Name, req.Description, req.StorageType, cfg,
	).Scan(
		&repo.ID, &repo.Name, &repo.Description, &repo.StorageType,
		&repo.StorageConfig, &repo.EncryptionKeyID, &repo.Compression,
		&repo.Status, &repo.TotalSizeBytes, &repo.TotalChunks,
		&repo.TotalSnapshots, &repo.CreatedAt, &repo.UpdatedAt,
	)
	if err != nil {
		h.logger.Error("create repo", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to create repository")
		return
	}

	respondJSON(w, http.StatusCreated, repo)
}

func (h *Handler) GetRepository(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var repo models.Repository
	err := h.db.QueryRow(r.Context(),
		`SELECT id, name, description, storage_type,
		        storage_config, encryption_key_id, compression,
		        status, total_size_bytes, total_chunks,
		        total_snapshots, created_at, updated_at
		 FROM repositories WHERE id = $1`, id,
	).Scan(
		&repo.ID, &repo.Name, &repo.Description, &repo.StorageType,
		&repo.StorageConfig, &repo.EncryptionKeyID, &repo.Compression,
		&repo.Status, &repo.TotalSizeBytes, &repo.TotalChunks,
		&repo.TotalSnapshots, &repo.CreatedAt, &repo.UpdatedAt,
	)
	if err != nil {
		respondError(w, http.StatusNotFound, "repository not found")
		return
	}

	respondJSON(w, http.StatusOK, repo)
}

func (h *Handler) UpdateRepository(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req models.UpdateRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var repo models.Repository
	err := h.db.QueryRow(r.Context(),
		`UPDATE repositories SET
			name = COALESCE($2, name),
			description = COALESCE($3, description),
			status = COALESCE($4::repository_status, status),
			updated_at = NOW()
		WHERE id = $1
		RETURNING id, name, description, storage_type,
		          storage_config, encryption_key_id, compression,
		          status, total_size_bytes, total_chunks,
		          total_snapshots, created_at, updated_at`,
		id, req.Name, req.Description, req.Status,
	).Scan(
		&repo.ID, &repo.Name, &repo.Description, &repo.StorageType,
		&repo.StorageConfig, &repo.EncryptionKeyID, &repo.Compression,
		&repo.Status, &repo.TotalSizeBytes, &repo.TotalChunks,
		&repo.TotalSnapshots, &repo.CreatedAt, &repo.UpdatedAt,
	)
	if err != nil {
		h.logger.Error("update repo", zap.Error(err))
		respondError(w, http.StatusNotFound, "repository not found")
		return
	}

	respondJSON(w, http.StatusOK, repo)
}

func (h *Handler) DeleteRepository(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	_, err := h.db.Exec(r.Context(),
		`DELETE FROM repositories WHERE id = $1`, id,
	)
	if err != nil {
		respondError(w, http.StatusNotFound, "repository not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
