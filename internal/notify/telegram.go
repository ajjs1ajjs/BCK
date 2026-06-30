package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type TelegramNotifier struct {
	botToken string
	chatID   string
	client   *http.Client
}

type telegramMessage struct {
	ChatID    string `json:"chat_id"`
	Text      string `json:"text"`
	ParseMode string `json:"parse_mode"`
}

func NewTelegramNotifier(botToken, chatID string) *TelegramNotifier {
	return &TelegramNotifier{
		botToken: botToken,
		chatID:   chatID,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (t *TelegramNotifier) Send(ctx context.Context, msg *Message) error {
	emoji := map[Level]string{
		LevelInfo:    "\u2139\uFE0F",
		LevelWarning: "\u26A0\uFE0F",
		LevelSuccess: "\u2705",
		LevelError:   "\u274C",
	}

	text := fmt.Sprintf("%s *%s*\n%s", emoji[msg.Level], msg.Title, msg.Body)

	tgMsg := telegramMessage{
		ChatID:    t.chatID,
		Text:      text,
		ParseMode: "Markdown",
	}

	data, err := json.Marshal(tgMsg)
	if err != nil {
		return fmt.Errorf("marshal telegram message: %w", err)
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", t.botToken)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("send telegram message: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("telegram API returned status %d", resp.StatusCode)
	}

	return nil
}

func (t *TelegramNotifier) Name() string {
	return "telegram"
}
