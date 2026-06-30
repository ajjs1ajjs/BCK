package backup

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type StorageTier string

const (
	TierHot   StorageTier = "hot"   // Frequent access, fast storage
	TierWarm  StorageTier = "warm"  // Occasional access, slower
	TierCold  StorageTier = "cold"  // Rare access, cold storage
	TierGlacier StorageTier = "glacier" // Archive, hours to retrieve
)

type LifecycleRule struct {
	Name          string       `json:"name"`
	RepositoryID  string       `json:"repository_id"`
	AgeDays       int          `json:"age_days"`
	MoveToTier    StorageTier  `json:"move_to_tier"`
	Enabled       bool         `json:"enabled"`
}

type ArchivedSnapshot struct {
	ID           string      `json:"id"`
	OriginalPath string      `json:"original_path"`
	ArchivedPath string      `json:"archived_path"`
	Tier         StorageTier `json:"tier"`
	ArchivedAt   time.Time   `json:"archived_at"`
	SizeBytes    int64       `json:"size_bytes"`
}

type LifecycleManager struct {
	db     *pgxpool.Pool
	logger *zap.Logger
	rules  []LifecycleRule
}

func NewLifecycleManager(db *pgxpool.Pool, logger *zap.Logger) *LifecycleManager {
	return &LifecycleManager{
		db:     db,
		logger: logger,
	}
}

func (lm *LifecycleManager) AddRule(rule LifecycleRule) {
	lm.rules = append(lm.rules, rule)
	lm.logger.Info("lifecycle rule added",
		zap.String("name", rule.Name),
		zap.String("tier", string(rule.MoveToTier)),
		zap.Int("age_days", rule.AgeDays),
	)
}

func (lm *LifecycleManager) ApplyRules(ctx context.Context) error {
	lm.logger.Info("applying lifecycle rules")

	for _, rule := range lm.rules {
		if !rule.Enabled {
			continue
		}

		cutoff := time.Now().Add(-time.Duration(rule.AgeDays) * 24 * time.Hour)

		rows, err := lm.db.Query(ctx,
			`SELECT id, snapshot_path, total_size_bytes
			 FROM snapshots
			 WHERE repository_id = $1 AND created_at < $2
			 ORDER BY created_at`, rule.RepositoryID, cutoff,
		)
		if err != nil {
			lm.logger.Error("query old snapshots", zap.Error(err))
			continue
		}

		var count int
		var totalBytes int64
		for rows.Next() {
			var id, path string
			var size int64
			if err := rows.Scan(&id, &path, &size); err != nil {
				continue
			}

			lm.logger.Info("moving snapshot to tier",
				zap.String("snapshot", id),
				zap.String("to_tier", string(rule.MoveToTier)),
				zap.Int64("size", size),
			)

			lm.db.Exec(ctx,
				`UPDATE snapshots SET metadata = metadata || jsonb_build_object('tier', $2, 'moved_to_tier_at', $3)
				 WHERE id = $1`,
				id, string(rule.MoveToTier), time.Now().Format(time.RFC3339),
			)

			count++
			totalBytes += size
		}
		rows.Close()

		if count > 0 {
			lm.logger.Info("lifecycle rule applied",
				zap.String("rule", rule.Name),
				zap.Int("snapshots_moved", count),
				zap.Int64("bytes_archived", totalBytes),
			)
		}
	}

	return nil
}

func (lm *LifecycleManager) GetStorageDistribution(ctx context.Context, repoID string) map[StorageTier]int64 {
	rows, err := lm.db.Query(ctx,
		`SELECT metadata->>'tier' as tier, COALESCE(SUM(total_size_bytes), 0)
		 FROM snapshots
		 WHERE repository_id = $1
		 GROUP BY metadata->>'tier'`,
		repoID,
	)
	if err != nil {
		return nil
	}
	defer rows.Close()

	dist := map[StorageTier]int64{
		TierHot: 0, TierWarm: 0, TierCold: 0, TierGlacier: 0,
	}

	for rows.Next() {
		var tier string
		var size int64
		if err := rows.Scan(&tier, &size); err != nil {
			continue
		}
		if tier == "" {
			tier = "hot"
		}
		dist[StorageTier(tier)] += size
	}

	return dist
}

type RetentionScheduler struct {
	lm *LifecycleManager
}

func NewRetentionScheduler(lm *LifecycleManager) *RetentionScheduler {
	return &RetentionScheduler{lm: lm}
}

func (rs *RetentionScheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			rs.lm.ApplyRules(ctx)
		}
	}
}

func TierCostEstimate(tier StorageTier) float64 {
	costs := map[StorageTier]float64{
		TierHot:     0.023, // $ per GB per month
		TierWarm:    0.0125,
		TierCold:    0.004,
		TierGlacier: 0.001,
	}
	return costs[tier]
}

func (lm *LifecycleManager) EstimateSavings(ctx context.Context, repoID string) (float64, error) {
	dist := lm.GetStorageDistribution(ctx, repoID)

	totalGB := float64(dist[TierHot]+dist[TierWarm]+dist[TierCold]+dist[TierGlacier]) / (1024*1024*1024)

	currentCost := float64(dist[TierHot])/(1024*1024*1024)*TierCostEstimate(TierHot) +
		float64(dist[TierWarm])/(1024*1024*1024)*TierCostEstimate(TierWarm) +
		float64(dist[TierCold])/(1024*1024*1024)*TierCostEstimate(TierCold) +
		float64(dist[TierGlacier])/(1024*1024*1024)*TierCostEstimate(TierGlacier)

	optimalCost := totalGB * TierCostEstimate(TierCold)

	return currentCost - optimalCost, nil
}
