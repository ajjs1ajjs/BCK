package security

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/ajjs1ajjs/BCK/internal/backup"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type SecurityManager struct {
	db        *pgxpool.Pool
	logger    *zap.Logger
	whitelist []*net.IPNet
	mu        sync.RWMutex
}

func NewSecurityManager(db *pgxpool.Pool, logger *zap.Logger) *SecurityManager {
	return &SecurityManager{db: db, logger: logger}
}

func (s *SecurityManager) SetWhitelist(cidrs []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.whitelist = nil
	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			s.logger.Warn("invalid CIDR", zap.String("cidr", cidr), zap.Error(err))
			continue
		}
		s.whitelist = append(s.whitelist, network)
	}
}

func (s *SecurityManager) IsIPAllowed(ipStr string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.whitelist) == 0 {
		return true
	}
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, network := range s.whitelist {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func GenerateTOTPSecret() (string, error) {
	secret := make([]byte, 20)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret), nil
}

func ValidateTOTP(secret string, code string) bool {
	if len(code) != 6 {
		return false
	}
	now := time.Now().Unix() / 30
	for i := int64(-1); i <= 1; i++ {
		expected := generateTOTPCode(secret, now+i)
		if subtle.ConstantTimeCompare([]byte(code), []byte(expected)) == 1 {
			return true
		}
	}
	return false
}

func generateTOTPCode(secret string, counter int64) string {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		return "000000"
	}
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(counter))
	mac := hmac.New(sha256.New, key)
	mac.Write(buf)
	hash := mac.Sum(nil)
	offset := hash[len(hash)-1] & 0x0F
	code := int64(hash[offset]&0x7F)<<24 |
		int64(hash[offset+1])<<16 |
		int64(hash[offset+2])<<8 |
		int64(hash[offset+3])
	code = code % 1000000
	return fmt.Sprintf("%06d", code)
}

type KeyRotationManager struct {
	currentKey  []byte
	previousKey []byte
	rotatedAt   time.Time
	mu          sync.RWMutex
}

func NewKeyRotationManager() *KeyRotationManager {
	return &KeyRotationManager{}
}

func (k *KeyRotationManager) Rotate() error {
	newKey, _, err := backup.GenerateKey()
	if err != nil {
		return fmt.Errorf("generate new key: %w", err)
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	k.previousKey = k.currentKey
	k.currentKey = newKey
	k.rotatedAt = time.Now()
	return nil
}

func (k *KeyRotationManager) GetCurrentKey() []byte {
	k.mu.RLock()
	defer k.mu.RUnlock()
	return k.currentKey
}

func (k *KeyRotationManager) GetPreviousKey() []byte {
	k.mu.RLock()
	defer k.mu.RUnlock()
	return k.previousKey
}

func (k *KeyRotationManager) LastRotated() time.Time {
	k.mu.RLock()
	defer k.mu.RUnlock()
	return k.rotatedAt
}

type AuditEntry struct {
	ID           string                 `json:"id"`
	UserID       string                 `json:"user_id"`
	Action       string                 `json:"action"`
	ResourceType string                 `json:"resource_type"`
	ResourceID   string                 `json:"resource_id"`
	Details      map[string]interface{} `json:"details,omitempty"`
	IPAddress    string                 `json:"ip_address"`
	CreatedAt    time.Time              `json:"created_at"`
}

type AuditLogger struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

func NewAuditLogger(db *pgxpool.Pool, logger *zap.Logger) *AuditLogger {
	return &AuditLogger{db: db, logger: logger}
}

func (a *AuditLogger) Log(ctx context.Context, userID, action, resourceType, resourceID, ipAddress string, details map[string]interface{}) error {
	detailsJSON := "{}"
	if details != nil {
		data, _ := json.Marshal(details)
		detailsJSON = string(data)
	}
	_, err := a.db.Exec(ctx,
		`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, details)
		 VALUES ($1, $2, $3, $4, $5::inet, $6)`,
		userID, action, resourceType, resourceID, ipAddress, detailsJSON,
	)
	if err != nil {
		a.logger.Error("audit log write failed", zap.Error(err))
		return err
	}
	a.logger.Info("audit event",
		zap.String("user_id", userID),
		zap.String("action", action),
		zap.String("resource", resourceType+"/"+resourceID),
		zap.String("ip", ipAddress),
	)
	return nil
}

func (a *AuditLogger) Query(ctx context.Context, userID string, limit int) ([]AuditEntry, error) {
	rows, err := a.db.Query(ctx,
		`SELECT id, user_id, action, resource_type, resource_id, details, host(ip_address), created_at
		 FROM audit_logs
		 WHERE ($1 = '' OR user_id = $1)
		 ORDER BY created_at DESC
		 LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []AuditEntry
	for rows.Next() {
		var e AuditEntry
		var detailsJSON []byte
		if err := rows.Scan(&e.ID, &e.UserID, &e.Action, &e.ResourceType, &e.ResourceID, &detailsJSON, &e.IPAddress, &e.CreatedAt); err != nil {
			continue
		}
		json.Unmarshal(detailsJSON, &e.Details)
		entries = append(entries, e)
	}
	return entries, nil
}
