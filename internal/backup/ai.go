package backup

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type StoragePrediction struct {
	DaysAhead     int     `json:"days_ahead"`
	PredictedBytes int64  `json:"predicted_bytes"`
	Confidence     float64 `json:"confidence"` // 0-1
	GrowthRate     float64 `json:"growth_rate_daily"`
}

type AnomalyResult struct {
	Timestamp   time.Time `json:"timestamp"`
	Metric      string    `json:"metric"`
	Value       float64   `json:"value"`
	Expected    float64   `json:"expected"`
	Deviation   float64   `json:"deviation"`
	Severity    string    `json:"severity"` // low, medium, high
}

type JobSuggestion struct {
	Type        string `json:"type"` // new_job, modify_schedule, increase_retention
	Description string `json:"description"`
	Confidence  float64 `json:"confidence"`
}

type AIAnalyzer struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

func NewAIAnalyzer(db *pgxpool.Pool, logger *zap.Logger) *AIAnalyzer {
	return &AIAnalyzer{db: db, logger: logger}
}

type storagePoint struct {
	size int64
	ts   time.Time
}

func (a *AIAnalyzer) PredictStorage(ctx context.Context, repositoryID string, daysAhead int) (*StoragePrediction, error) {
	rows, err := a.db.Query(ctx,
		`SELECT total_size_bytes, created_at
		 FROM snapshots
		 WHERE repository_id = $1
		 ORDER BY created_at DESC
		 LIMIT 90`, repositoryID,
	)
	if err != nil {
		return nil, fmt.Errorf("query snapshots: %w", err)
	}
	defer rows.Close()

	var points []storagePoint
	for rows.Next() {
		var p storagePoint
		if err := rows.Scan(&p.size, &p.ts); err != nil {
			continue
		}
		points = append(points, p)
	}

	if len(points) < 7 {
		return &StoragePrediction{
			DaysAhead:     daysAhead,
			PredictedBytes: 0,
			Confidence:    0.1,
		}, nil
	}

	// Simple linear regression on daily growth
	sort.Slice(points, func(i, j int) bool { return points[i].ts.Before(points[j].ts) })

	var sumX, sumY, sumXY, sumX2 float64
	n := float64(len(points))

	baseTime := points[0].ts
	for _, p := range points {
		x := p.ts.Sub(baseTime).Hours() / 24
		y := float64(p.size) / (1024 * 1024) // MB
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}

	slope := (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX)

	if slope < 0 {
		slope = 0
	}

	lastSize := float64(points[len(points)-1].size)
	predictedMB := lastSize/(1024*1024) + slope*float64(daysAhead)

	rSquared := a.calculateRSquared(points, slope, baseTime)

	return &StoragePrediction{
		DaysAhead:     daysAhead,
		PredictedBytes: int64(predictedMB * 1024 * 1024),
		Confidence:     rSquared,
		GrowthRate:     slope / (lastSize / (1024 * 1024)),
	}, nil
}

func (a *AIAnalyzer) DetectAnomalies(ctx context.Context, jobID string) ([]AnomalyResult, error) {
	rows, err := a.db.Query(ctx,
		`SELECT duration_seconds, bytes_processed, files_processed, started_at
		 FROM job_runs
		 WHERE job_id = $1 AND status = 'success'
		 ORDER BY started_at DESC
		 LIMIT 30`, jobID,
	)
	if err != nil {
		return nil, fmt.Errorf("query runs: %w", err)
	}
	defer rows.Close()

	type runMetrics struct {
		duration float64
		bytes    int64
		files    int64
		ts       time.Time
	}

	var runs []runMetrics
	for rows.Next() {
		var r runMetrics
		var ts *time.Time
		if err := rows.Scan(&r.duration, &r.bytes, &r.files, &ts); err != nil {
			continue
		}
		if ts != nil {
			r.ts = *ts
		}
		runs = append(runs, r)
	}

	if len(runs) < 5 {
		return nil, nil
	}

	var meanDuration, meanBytes, meanFiles float64
	for _, r := range runs {
		meanDuration += r.duration
		meanBytes += float64(r.bytes)
		meanFiles += float64(r.files)
	}
	meanDuration /= float64(len(runs))
	meanBytes /= float64(len(runs))
	meanFiles /= float64(len(runs))

	var stdDevDuration float64
	for _, r := range runs {
		stdDevDuration += math.Pow(r.duration-meanDuration, 2)
	}
	stdDevDuration = math.Sqrt(stdDevDuration / float64(len(runs)))

	var anomalies []AnomalyResult

	threshold := 2.0 // 2 standard deviations

	latest := runs[0]
	deviation := math.Abs(latest.duration-meanDuration) / stdDevDuration

	if deviation > threshold {
		severity := "medium"
		if deviation > 3 {
			severity = "high"
		}

		anomalies = append(anomalies, AnomalyResult{
			Timestamp: latest.ts,
			Metric:    "duration_seconds",
			Value:     latest.duration,
			Expected:  meanDuration,
			Deviation: deviation,
			Severity:  severity,
		})
	}

	stdDevBytes := 0.0
	for _, r := range runs {
		stdDevBytes += math.Pow(float64(r.bytes)-meanBytes, 2)
	}
	stdDevBytes = math.Sqrt(stdDevBytes / float64(len(runs)))

	if stdDevBytes > 0 {
		byteDeviation := math.Abs(float64(latest.bytes)-meanBytes) / stdDevBytes
		if byteDeviation > threshold {
			anomalies = append(anomalies, AnomalyResult{
				Timestamp: latest.ts,
				Metric:    "bytes_processed",
				Value:     float64(latest.bytes),
				Expected:  meanBytes,
				Deviation: byteDeviation,
				Severity:  "low",
			})
		}
	}

	return anomalies, nil
}

func (a *AIAnalyzer) SuggestPolicies(ctx context.Context) ([]JobSuggestion, error) {
	var suggestions []JobSuggestion

	var uncategorizedJobs int
	a.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM backup_jobs WHERE source_path IS NOT NULL AND cron_expression IS NULL`,
	).Scan(&uncategorizedJobs)

	if uncategorizedJobs > 0 {
		suggestions = append(suggestions, JobSuggestion{
			Type:        "modify_schedule",
			Description: fmt.Sprintf("%d jobs lack schedules. Consider adding cron expressions for automated backup.", uncategorizedJobs),
			Confidence:  0.9,
		})
	}

	var noRetentionJobs int
	a.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM backup_jobs WHERE retention_policy_id IS NULL AND status = 'active'`,
	).Scan(&noRetentionJobs)

	if noRetentionJobs > 0 {
		suggestions = append(suggestions, JobSuggestion{
			Type:        "increase_retention",
			Description: fmt.Sprintf("%d active jobs have no retention policy. Old backups may accumulate.", noRetentionJobs),
			Confidence:  0.95,
		})
	}

	var failedYesterday int
	a.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM job_runs WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'`,
	).Scan(&failedYesterday)

	if failedYesterday > 0 {
		suggestions = append(suggestions, JobSuggestion{
			Type:        "new_job",
			Description: fmt.Sprintf("%d jobs failed in last 24h. Review error logs and consider adjusting timeouts.", failedYesterday),
			Confidence:  0.85,
		})
	}

	return suggestions, nil
}

func (a *AIAnalyzer) calculateRSquared(points []storagePoint, slope float64, baseTime time.Time) float64 {
	if len(points) < 2 {
		return 0
	}

	var meanY float64
	for _, p := range points {
		meanY += float64(p.size) / (1024 * 1024)
	}
	meanY /= float64(len(points))

	var ssRes, ssTotal float64
	for _, p := range points {
		x := p.ts.Sub(baseTime).Hours() / 24
		y := float64(p.size) / (1024 * 1024)
		predicted := slope*x + float64(points[0].size)/(1024*1024)
		ssRes += math.Pow(y-predicted, 2)
		ssTotal += math.Pow(y-meanY, 2)
	}

	if ssTotal == 0 {
		return 1
	}

	r2 := 1 - ssRes/ssTotal
	if r2 < 0 {
		r2 = 0
	}
	return r2
}
