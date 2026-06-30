package models

import (
	"encoding/json"
	"time"
)

type RepositoryStatus string

const (
	RepoStatusActive   RepositoryStatus = "active"
	RepoStatusInactive RepositoryStatus = "inactive"
	RepoStatusError    RepositoryStatus = "error"
)

type Repository struct {
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Description     string           `json:"description,omitempty"`
	StorageType     string           `json:"storage_type"`
	StorageConfig   json.RawMessage  `json:"storage_config"`
	EncryptionKeyID string           `json:"encryption_key_id,omitempty"`
	Compression     string           `json:"compression"`
	Status          RepositoryStatus `json:"status"`
	TotalSizeBytes  int64            `json:"total_size_bytes"`
	TotalChunks     int64            `json:"total_chunks"`
	TotalSnapshots  int64            `json:"total_snapshots"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}

type CreateRepoRequest struct {
	Name        string `json:"name" validate:"required,min=1,max=255"`
	Description string `json:"description,omitempty"`
	StorageType string `json:"storage_type" validate:"required,oneof=local s3"`
}

type UpdateRepoRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Status      *string `json:"status,omitempty"`
}

type LocalStorageConfig struct {
	Path string `json:"path"`
}
