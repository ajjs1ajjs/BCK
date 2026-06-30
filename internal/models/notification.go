package models

import (
	"encoding/json"
	"time"
)

type NotificationType string

const (
	NotifInfo    NotificationType = "info"
	NotifWarning NotificationType = "warning"
	NotifSuccess NotificationType = "success"
	NotifError   NotificationType = "error"
)

type NotificationChannel string

const (
	ChannelEmail    NotificationChannel = "email"
	ChannelTelegram NotificationChannel = "telegram"
	ChannelWebhook  NotificationChannel = "webhook"
	ChannelDiscord  NotificationChannel = "discord"
)

type Notification struct {
	ID        string             `json:"id"`
	UserID    string             `json:"user_id"`
	Channel   NotificationChannel `json:"channel"`
	Type      NotificationType   `json:"type"`
	Title     string             `json:"title"`
	Message   string             `json:"message,omitempty"`
	IsRead    bool               `json:"is_read"`
	Metadata  json.RawMessage    `json:"metadata,omitempty"`
	CreatedAt time.Time          `json:"created_at"`
}
