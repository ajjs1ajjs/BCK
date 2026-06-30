package scheduler

import (
	"fmt"
	"time"

	"github.com/robfig/cron/v3"
)

func ValidateCronExpression(expr string) error {
	parser := cron.NewParser(cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	_, err := parser.Parse(expr)
	if err != nil {
		return fmt.Errorf("invalid cron expression: %w", err)
	}
	return nil
}

func NextRun(expr string) (time.Time, error) {
	parser := cron.NewParser(cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	schedule, err := parser.Parse(expr)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse cron: %w", err)
	}
	return schedule.Next(time.Now()), nil
}

func DescribeSchedule(expr string) string {
	parser := cron.NewParser(cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	schedule, err := parser.Parse(expr)
	if err != nil {
		return "Invalid schedule"
	}

	next := schedule.Next(time.Now())
	next2 := schedule.Next(next)

	interval := next2.Sub(next)

	switch {
	case interval >= 24*time.Hour:
		days := int(interval.Hours() / 24)
		if days == 1 {
			return "Daily"
		}
		return fmt.Sprintf("Every %d days", days)
	case interval >= time.Hour:
		hours := int(interval.Hours())
		if hours == 1 {
			return "Hourly"
		}
		return fmt.Sprintf("Every %d hours", hours)
	case interval >= time.Minute:
		minutes := int(interval.Minutes())
		return fmt.Sprintf("Every %d minutes", minutes)
	default:
		return "Custom schedule"
	}
}
