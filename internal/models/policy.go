package models

import (
	"encoding/json"
	"time"
)

type RetentionPolicy struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Rules       json.RawMessage `json:"rules"`
	IsDefault   bool            `json:"is_default"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type RetentionRule struct {
	Frequency string `json:"frequency"` // hourly, daily, weekly, monthly, yearly
	Keep      int    `json:"keep"`
}

type CreatePolicyRequest struct {
	Name        string          `json:"name" validate:"required,min=1,max=255"`
	Description string          `json:"description,omitempty"`
	Rules       json.RawMessage `json:"rules" validate:"required"`
	IsDefault   bool            `json:"is_default"`
}
