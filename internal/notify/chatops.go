package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"
)

type ChatProvider string

const (
	ChatSlack  ChatProvider = "slack"
	ChatTeams  ChatProvider = "teams"
	ChatDiscord ChatProvider = "discord"
)

type ChatMessage struct {
	Text       string                 `json:"text"`
	Channel    string                 `json:"channel,omitempty"`
	Color      string                 `json:"color,omitempty"`
	Actions    []ChatAction           `json:"actions,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

type ChatAction struct {
	Name    string `json:"name"`
	Text    string `json:"text"`
	Value   string `json:"value"`
	Style   string `json:"style,omitempty"` // primary, danger
}

type CommandHandler func(ctx context.Context, args []string, user string) (string, error)

type ChatOps struct {
	provider ChatProvider
	webhookURL string
	commands map[string]CommandHandler
	token    string
	client   *http.Client
	logger   *zap.Logger
}

func NewChatOps(provider ChatProvider, webhookURL, token string, logger *zap.Logger) *ChatOps {
	return &ChatOps{
		provider:   provider,
		webhookURL: webhookURL,
		token:      token,
		commands:   make(map[string]CommandHandler),
		client:     &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}
}

func (c *ChatOps) RegisterCommand(name string, handler CommandHandler) {
	c.commands[name] = handler
	c.logger.Info("chat command registered", zap.String("command", name))
}

func (c *ChatOps) HandleCommand(ctx context.Context, command string, args []string, user string) (string, error) {
	handler, exists := c.commands[command]
	if !exists {
		return "", fmt.Errorf("unknown command: %s. Use /help", command)
	}
	return handler(ctx, args, user)
}

func (c *ChatOps) SendMessage(ctx context.Context, msg *ChatMessage) error {
	switch c.provider {
	case ChatSlack:
		return c.sendSlack(ctx, msg)
	case ChatTeams:
		return c.sendTeams(ctx, msg)
	case ChatDiscord:
		return c.sendDiscordChat(ctx, msg)
	default:
		return fmt.Errorf("unsupported provider: %s", c.provider)
	}
}

func (c *ChatOps) sendSlack(ctx context.Context, msg *ChatMessage) error {
	payload := map[string]interface{}{
		"text": msg.Text,
		"channel": msg.Channel,
	}

	if msg.Actions != nil {
		var attachments []map[string]interface{}
		var actions []map[string]interface{}

		for _, action := range msg.Actions {
			actions = append(actions, map[string]interface{}{
				"type":  "button",
				"text":  action.Text,
				"value": action.Value,
				"style": action.Style,
				"action_id": action.Name,
			})
		}

		attachments = append(attachments, map[string]interface{}{
			"color":   msg.Color,
			"actions": actions,
		})
		payload["attachments"] = attachments
	}

	data, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", c.webhookURL, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("slack returned %d", resp.StatusCode)
	}

	c.logger.Info("slack message sent", zap.String("channel", msg.Channel))
	return nil
}

func (c *ChatOps) sendTeams(ctx context.Context, msg *ChatMessage) error {
	var facts []map[string]string

	facts = append(facts, map[string]string{"name": "Status", "value": msg.Color})

	payload := map[string]interface{}{
		"@type":    "MessageCard",
		"@context": "https://schema.org/extensions",
		"summary":  msg.Text,
		"themeColor": colorToHex(msg.Color),
		"sections": []map[string]interface{}{
			{
				"activityTitle": msg.Text,
				"facts":         facts,
			},
		},
	}

	if msg.Actions != nil {
		var actions []map[string]interface{}
		for _, action := range msg.Actions {
			actions = append(actions, map[string]interface{}{
				"@type":  "ActionCard",
				"name":   action.Name,
				"title":  action.Text,
			})
		}
		payload["potentialAction"] = actions
	}

	data, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", c.webhookURL, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("teams returned %d", resp.StatusCode)
	}

	return nil
}

func (c *ChatOps) sendDiscordChat(ctx context.Context, msg *ChatMessage) error {
	payload := map[string]interface{}{
		"content": msg.Text,
	}

	if msg.Actions != nil {
		var components []map[string]interface{}
		for _, action := range msg.Actions {
			style := 1
			if action.Style == "danger" {
				style = 4
			}
			components = append(components, map[string]interface{}{
				"type": 2,
				"style": style,
				"label": action.Text,
				"custom_id": action.Name,
			})
		}
		payload["components"] = []map[string]interface{}{
			{"type": 1, "components": components},
		}
	}

	data, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", c.webhookURL, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("discord returned %d", resp.StatusCode)
	}

	return nil
}

func (c *ChatOps) NotifyBackupComplete(ctx context.Context, jobName, snapshotID string, fileCount, bytesProcessed int64, err error) {
	status := "✅ Success"
	color := "good"
	if err != nil {
		status = "❌ Failed"
		color = "danger"
	}

	msg := &ChatMessage{
		Text: fmt.Sprintf("*Backup: %s*\nStatus: %s\nSnapshot: %s\nFiles: %d\nSize: %d MB",
			jobName, status, snapshotID, fileCount, bytesProcessed/(1024*1024)),
		Color: color,
		Actions: []ChatAction{
			{Name: "view_logs", Text: "View Logs", Value: snapshotID},
			{Name: "run_again", Text: "Run Again", Value: jobName},
		},
	}

	c.SendMessage(ctx, msg)
}

func colorToHex(color string) string {
	colors := map[string]string{
		"good":    "00FF00",
		"warning": "FFA500",
		"danger":  "FF0000",
		"info":    "0000FF",
	}
	if hex, ok := colors[color]; ok {
		return hex
	}
	return "808080"
}

func (c *ChatOps) SetupDefaultCommands() {
	c.RegisterCommand("help", func(ctx context.Context, args []string, user string) (string, error) {
		var cmds []string
		for name := range c.commands {
			cmds = append(cmds, name)
		}
		return fmt.Sprintf("Available commands: /%s", strings.Join(cmds, ", ")), nil
	})

	c.RegisterCommand("status", func(ctx context.Context, args []string, user string) (string, error) {
		return fmt.Sprintf("BCK Backup Manager is operational. Connected to %s.", c.provider), nil
	})

	c.RegisterCommand("jobs", func(ctx context.Context, args []string, user string) (string, error) {
		return "Use /jobs list | /jobs run <id> | /jobs logs <id>", nil
	})
}
