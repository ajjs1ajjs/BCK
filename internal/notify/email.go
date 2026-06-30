package notify

import (
	"context"
	"fmt"
	"net/smtp"
	"strings"
)

type EmailNotifier struct {
	smtpHost string
	smtpPort int
	username string
	password string
	from     string
	to       []string
}

func NewEmailNotifier(host string, port int, username, password, from string, to []string) *EmailNotifier {
	return &EmailNotifier{
		smtpHost: host,
		smtpPort: port,
		username: username,
		password: password,
		from:     from,
		to:       to,
	}
}

func (e *EmailNotifier) Send(ctx context.Context, msg *Message) error {
	addr := fmt.Sprintf("%s:%d", e.smtpHost, e.smtpPort)

	body := fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: [%s] %s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		e.from,
		strings.Join(e.to, ", "),
		strings.ToUpper(string(msg.Level)),
		msg.Title,
		msg.Body,
	)

	auth := smtp.PlainAuth("", e.username, e.password, e.smtpHost)
	return smtp.SendMail(addr, auth, e.from, e.to, []byte(body))
}

func (e *EmailNotifier) Name() string {
	return "email"
}
