package models

import (
	"time"
)

type AgentStatus string

const (
	AgentOnline  AgentStatus = "online"
	AgentOffline AgentStatus = "offline"
)

type Agent struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Hostname     string      `json:"hostname"`
	Address      string      `json:"address"`
	Port         int         `json:"port"`
	Version      string      `json:"version"`
	Status       AgentStatus `json:"status"`
	LastSeenAt   *time.Time  `json:"last_seen_at,omitempty"`
	RegisteredAt time.Time   `json:"registered_at"`
	Labels       []string    `json:"labels,omitempty"`
}

type RegisterAgentRequest struct {
	Name     string   `json:"name" validate:"required"`
	Address  string   `json:"address" validate:"required"`
	Port     int      `json:"port" validate:"required"`
	Version  string   `json:"version"`
	Labels   []string `json:"labels,omitempty"`
}
