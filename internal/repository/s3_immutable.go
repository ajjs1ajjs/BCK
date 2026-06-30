package repository

import (
	"bytes"
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const (
	ObjectLockRetainUntilDate = "RetainUntilDate"
	ObjectLockLegalHold       = "LegalHold"
)

type S3ImmutableConfig struct {
	Enabled        bool   `json:"enabled"`
	RetentionDays  int    `json:"retention_days"`
	RetentionMode  string `json:"retention_mode"` // "GOVERNANCE" or "COMPLIANCE"
	LegalHold      bool   `json:"legal_hold"`
}

type S3ImmutableRepo struct {
	S3Repo
	immuCfg S3ImmutableConfig
}

func NewS3ImmutableRepo(cfg S3Config, immuCfg S3ImmutableConfig) (*S3ImmutableRepo, error) {
	repo, err := NewS3Repo(cfg)
	if err != nil {
		return nil, err
	}

	return &S3ImmutableRepo{
		S3Repo:  *repo,
		immuCfg: immuCfg,
	}, nil
}

func (r *S3ImmutableRepo) StoreChunk(id string, data []byte) error {
	key := r.key("chunks/" + id[:2] + "/" + id)

	retainDate := time.Now().Add(time.Duration(r.immuCfg.RetentionDays) * 24 * time.Hour)

	input := &s3.PutObjectInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader(data),
	}

	if r.immuCfg.Enabled {
		mode := types.ObjectLockRetentionModeGovernance
		if r.immuCfg.RetentionMode == "COMPLIANCE" {
			mode = types.ObjectLockRetentionModeCompliance
		}

		input.ObjectLockMode = types.ObjectLockMode(mode)
		input.ObjectLockRetainUntilDate = aws.Time(retainDate)

		if r.immuCfg.LegalHold {
			input.ObjectLockLegalHoldStatus = types.ObjectLockLegalHoldStatusOn
		}
	}

	_, err := r.client.PutObject(context.Background(), input)
	return err
}

func (r *S3ImmutableRepo) DeleteChunk(id string) error {
	if r.immuCfg.LegalHold {
		return fmt.Errorf("delete blocked: S3 legal hold active")
	}
	return r.S3Repo.DeleteChunk(id)
}

func (r *S3ImmutableRepo) DeleteSnapshot(id string) error {
	if r.immuCfg.LegalHold {
		return fmt.Errorf("delete blocked: S3 legal hold active")
	}
	return r.S3Repo.DeleteSnapshot(id)
}

func (r *S3ImmutableRepo) SetLegalHold(id string, enable bool) error {
	key := r.key("chunks/" + id[:2] + "/" + id)

	status := types.ObjectLockLegalHoldStatusOff
	if enable {
		status = types.ObjectLockLegalHoldStatusOn
	}

	_, err := r.client.PutObjectLegalHold(context.Background(), &s3.PutObjectLegalHoldInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
		LegalHold: &types.ObjectLockLegalHold{
			Status: status,
		},
	})
	return err
}

func (r *S3ImmutableRepo) GetObjectRetention(id string) (*types.ObjectLockRetention, error) {
	key := r.key("chunks/" + id[:2] + "/" + id)

	resp, err := r.client.GetObjectRetention(context.Background(), &s3.GetObjectRetentionInput{
		Bucket: aws.String(r.cfg.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("get retention: %w", err)
	}
	return resp.Retention, nil
}
