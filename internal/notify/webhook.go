package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type WebhookNotifier struct {
	url    string
	secret string
	client *http.Client
}

type webhookPayload struct {
	Title    string            `json:"title"`
	Body     string            `json:"body"`
	Level    string            `json:"level"`
	Metadata map[string]string `json:"metadata,omitempty"`
	SentAt   string            `json:"sent_at"`
}

func NewWebhookNotifier(url, secret string) *WebhookNotifier {
	return &WebhookNotifier{
		url:    url,
		secret: secret,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (w *WebhookNotifier) Send(ctx context.Context, msg *Message) error {
	payload := webhookPayload{
		Title:    msg.Title,
		Body:     msg.Body,
		Level:    string(msg.Level),
		Metadata: msg.Metadata,
		SentAt:   time.Now().UTC().Format(time.RFC3339),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal webhook payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	if w.secret != "" {
		req.Header.Set("X-Webhook-Secret", w.secret)
	}

	resp, err := w.client.Do(req)
	if err != nil {
		return fmt.Errorf("send webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}

func (w *WebhookNotifier) Name() string {
	return "webhook"
}
