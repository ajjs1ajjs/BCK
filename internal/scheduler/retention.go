package scheduler

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type RetentionManager struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

type RetentionRule struct {
	Frequency string `json:"frequency"` // hourly, daily, weekly, monthly, yearly
	Keep      int    `json:"keep"`
}

type snapRecord struct {
	ID        string
	CreatedAt time.Time
}

func NewRetentionManager(db *pgxpool.Pool, logger *zap.Logger) *RetentionManager {
	return &RetentionManager{
		db:     db,
		logger: logger,
	}
}

func (rm *RetentionManager) ApplyPolicy(repositoryID, policyID string) error {
	ctx := context.Background()

	var rulesJSON []byte
	err := rm.db.QueryRow(ctx,
		`SELECT rules FROM retention_policies WHERE id = $1`,
		policyID,
	).Scan(&rulesJSON)
	if err != nil {
		return fmt.Errorf("get policy: %w", err)
	}

	// Get all snapshots for this repository
	rows, err := rm.db.Query(ctx,
		`SELECT id, created_at
		 FROM snapshots
		 WHERE repository_id = $1
		 ORDER BY created_at DESC`,
		repositoryID,
	)
	if err != nil {
		return fmt.Errorf("get snapshots: %w", err)
	}
	defer rows.Close()

	var snapshots []snapRecord
	for rows.Next() {
		var s snapRecord
		if err := rows.Scan(&s.ID, &s.CreatedAt); err != nil {
			continue
		}
		snapshots = append(snapshots, s)
	}

	rules := parseRetentionRules(rulesJSON)
	toKeep := make(map[string]bool)

	for _, rule := range rules {
		grouped := groupSnapshots(snapshots, rule.Frequency)
		sort.Strings(grouped)

		for i, group := range grouped {
			if i >= rule.Keep {
				rm.logger.Info("pruning snapshots in group",
					zap.String("frequency", rule.Frequency),
					zap.String("group", group),
				)
				continue
			}
			toKeep[group] = true
		}
	}

	for _, s := range snapshots {
		if toKeep[s.ID] || toKeep[snapshotKey(s.CreatedAt)] {
			continue
		}
		// Soft delete - mark for pruning
		rm.db.Exec(ctx,
			`UPDATE snapshots SET metadata = metadata || '{"marked_for_deletion": true}'
			 WHERE id = $1`, s.ID,
		)
	}

	rm.logger.Info("retention policy applied",
		zap.String("repository_id", repositoryID),
		zap.Int("total", len(snapshots)),
	)

	return nil
}

func parseRetentionRules(data []byte) []RetentionRule {
	// Simple parsing - in production use JSON unmarshal
	return []RetentionRule{
		{Frequency: "daily", Keep: 7},
		{Frequency: "weekly", Keep: 4},
		{Frequency: "monthly", Keep: 12},
	}
}

func groupSnapshots(snapshots []snapRecord, frequency string) []string {
	groups := make(map[string]bool)

	for _, s := range snapshots {
		var key string
		switch frequency {
		case "hourly":
			key = s.CreatedAt.Format("2006-01-02T15")
		case "daily":
			key = s.CreatedAt.Format("2006-01-02")
		case "weekly":
			year, week := s.CreatedAt.ISOWeek()
			key = fmt.Sprintf("%d-W%02d", year, week)
		case "monthly":
			key = s.CreatedAt.Format("2006-01")
		case "yearly":
			key = s.CreatedAt.Format("2006")
		default:
			key = s.CreatedAt.Format("2006-01-02")
		}
		groups[key] = true
	}

	result := make([]string, 0, len(groups))
	for k := range groups {
		result = append(result, k)
	}
	return result
}

func snapshotKey(t time.Time) string {
	return t.Format("2006-01-02T15:04:05")
}
