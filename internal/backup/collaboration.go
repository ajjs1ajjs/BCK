package backup

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type ShareLink struct {
	ID          string    `json:"id"`
	SnapshotID  string    `json:"snapshot_id"`
	Token       string    `json:"token"`
	ExpiresAt   time.Time `json:"expires_at"`
	MaxDownloads int      `json:"max_downloads"`
	Downloads   int       `json:"downloads"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	IsActive    bool      `json:"is_active"`
}

type ApprovalRequest struct {
	ID        string    `json:"id"`
	JobID     string    `json:"job_id"`
	Action    string    `json:"action"` // run, restore, delete
	RequestedBy string  `json:"requested_by"`
	ApprovedBy string   `json:"approved_by,omitempty"`
	Status    string    `json:"status"` // pending, approved, rejected
	Reason    string    `json:"reason,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type CollaborationManager struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

func NewCollaborationManager(db *pgxpool.Pool, logger *zap.Logger) *CollaborationManager {
	return &CollaborationManager{db: db, logger: logger}
}

func (cm *CollaborationManager) CreateShareLink(ctx context.Context, snapshotID, createdBy string, expiresIn time.Duration, maxDownloads int) (*ShareLink, error) {
	token := make([]byte, 32)
	rand.Read(token)

	link := &ShareLink{
		ID:          fmt.Sprintf("share-%d", time.Now().UnixNano()),
		SnapshotID:  snapshotID,
		Token:       hex.EncodeToString(token),
		ExpiresAt:   time.Now().Add(expiresIn),
		MaxDownloads: maxDownloads,
		CreatedBy:   createdBy,
		CreatedAt:   time.Now(),
		IsActive:    true,
	}

	cm.logger.Info("share link created",
		zap.String("snapshot", snapshotID),
		zap.String("token", link.Token[:8]+"..."),
	)

	return link, nil
}

func (cm *CollaborationManager) ValidateShareLink(link *ShareLink) error {
	if !link.IsActive {
		return fmt.Errorf("share link is inactive")
	}
	if time.Now().After(link.ExpiresAt) {
		return fmt.Errorf("share link expired at %s", link.ExpiresAt.Format(time.RFC3339))
	}
	if link.MaxDownloads > 0 && link.Downloads >= link.MaxDownloads {
		return fmt.Errorf("share link download limit reached")
	}
	return nil
}

func (cm *CollaborationManager) CreateApprovalRequest(ctx context.Context, jobID, action, requestedBy string) (*ApprovalRequest, error) {
	req := &ApprovalRequest{
		ID:          fmt.Sprintf("approval-%d", time.Now().UnixNano()),
		JobID:       jobID,
		Action:      action,
		RequestedBy: requestedBy,
		Status:      "pending",
		CreatedAt:   time.Now(),
	}

	cm.logger.Info("approval request created",
		zap.String("job", jobID),
		zap.String("action", action),
	)

	return req, nil
}

func (cm *CollaborationManager) ApproveRequest(req *ApprovalRequest, approvedBy string) {
	req.Status = "approved"
	req.ApprovedBy = approvedBy
	cm.logger.Info("request approved",
		zap.String("job", req.JobID),
		zap.String("by", approvedBy),
	)
}

func (cm *CollaborationManager) RejectRequest(req *ApprovalRequest, rejectedBy, reason string) {
	req.Status = "rejected"
	req.ApprovedBy = rejectedBy
	req.Reason = reason
	cm.logger.Info("request rejected",
		zap.String("job", req.JobID),
		zap.String("by", rejectedBy),
		zap.String("reason", reason),
	)
}

type TeamReview struct {
	ID        string    `json:"id"`
	JobID     string    `json:"job_id"`
	Reviewer  string    `json:"reviewer"`
	Status    string    `json:"status"`
	Comment   string    `json:"comment,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type BackupReport struct {
	JobName      string    `json:"job_name"`
	LastRun      time.Time `json:"last_run"`
	Status       string    `json:"status"`
	Size         int64     `json:"size"`
	Files        int64     `json:"files"`
	Reviewed     bool      `json:"reviewed"`
}

func (cm *CollaborationManager) GenerateTeamReport(ctx context.Context, orgID string) ([]BackupReport, error) {
	rows, err := cm.db.Query(ctx,
		`SELECT bj.name, jr.started_at, jr.status, jr.bytes_processed, jr.files_processed
		 FROM backup_jobs bj
		 JOIN job_runs jr ON jr.job_id = bj.id
		 WHERE bj.organization_id = $1 AND jr.started_at > NOW() - INTERVAL '7 days'
		 ORDER BY jr.started_at DESC`, orgID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reports []BackupReport
	for rows.Next() {
		var r BackupReport
		var startedAt *time.Time
		if err := rows.Scan(&r.JobName, &startedAt, &r.Status, &r.Size, &r.Files); err != nil {
			continue
		}
		if startedAt != nil {
			r.LastRun = *startedAt
		}
		reports = append(reports, r)
	}
	return reports, nil
}
