package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type DiscordNotifier struct {
	webhookURL string
	client     *http.Client
}

type discordEmbed struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Color       int    `json:"color"`
	Timestamp   string `json:"timestamp"`
}

type discordPayload struct {
	Embeds []discordEmbed `json:"embeds"`
}

func NewDiscordNotifier(webhookURL string) *DiscordNotifier {
	return &DiscordNotifier{
		webhookURL: webhookURL,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (d *DiscordNotifier) Send(ctx context.Context, msg *Message) error {
	color := map[Level]int{
		LevelInfo:    3447003,  // Blue
		LevelWarning: 16776960, // Yellow
		LevelSuccess: 3066993,  // Green
		LevelError:   15158332, // Red
	}

	payload := discordPayload{
		Embeds: []discordEmbed{
			{
				Title:       msg.Title,
				Description: msg.Body,
				Color:       color[msg.Level],
				Timestamp:   time.Now().UTC().Format(time.RFC3339),
			},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal discord payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.webhookURL, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("send discord message: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("discord API returned status %d", resp.StatusCode)
	}

	return nil
}

func (d *DiscordNotifier) Name() string {
	return "discord"
}
