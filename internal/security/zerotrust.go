package security

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"sync"
	"time"

	"go.uber.org/zap"
)

type ZeroTrustPolicy struct {
	Name           string   `json:"name"`
	VerifyIdentity bool     `json:"verify_identity"`
	VerifyDevice   bool     `json:"verify_device"`
	VerifyContext  bool     `json:"verify_context"`
	AllowedRoles   []string `json:"allowed_roles"`
	AllowedCIDRs   []string `json:"allowed_cidrs,omitempty"`
	MaxSessionTime int      `json:"max_session_minutes"`
	RequireMFA     bool     `json:"require_mfa"`
}

type VerifiableIdentity struct {
	ID        string            `json:"id"`
	Type      string            `json:"type"` // spiffe, jwt, x509
	Claims    map[string]string `json:"claims"`
	ExpiresAt time.Time         `json:"expires_at"`
	Issuer    string            `json:"issuer"`
}

type AttestationReport struct {
	NodeID    string    `json:"node_id"`
	Platform  string    `json:"platform"`
	BootHash  string    `json:"boot_hash"`
	KernelHash string   `json:"kernel_hash"`
	Verified  bool      `json:"verified"`
	Timestamp time.Time `json:"timestamp"`
	Violations []string `json:"violations,omitempty"`
}

type ZeroTrustManager struct {
	policies   map[string]*ZeroTrustPolicy
	sessions   map[string]*VerifiableIdentity
	tlsConfig  *tls.Config
	mu         sync.RWMutex
	logger     *zap.Logger
}

func NewZeroTrustManager(logger *zap.Logger) (*ZeroTrustManager, error) {
	zt := &ZeroTrustManager{
		policies: make(map[string]*ZeroTrustPolicy),
		sessions: make(map[string]*VerifiableIdentity),
		logger:   logger,
	}

	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS13,
		ClientAuth: tls.RequireAndVerifyClientCert,
		VerifyPeerCertificate: zt.verifyPeer,
	}

	zt.tlsConfig = tlsConfig

	return zt, nil
}

func (zt *ZeroTrustManager) verifyPeer(rawCerts [][]byte, verifiedChains [][]*x509.Certificate) error {
	if len(rawCerts) == 0 {
		return fmt.Errorf("no client certificate provided")
	}

	cert, err := x509.ParseCertificate(rawCerts[0])
	if err != nil {
		return fmt.Errorf("parse certificate: %w", err)
	}

	zt.logger.Info("peer verified",
		zap.String("subject", cert.Subject.CommonName),
		zap.String("issuer", cert.Issuer.CommonName),
	)

	return nil
}

func (zt *ZeroTrustManager) AddPolicy(policy *ZeroTrustPolicy) {
	zt.mu.Lock()
	defer zt.mu.Unlock()
	zt.policies[policy.Name] = policy
	zt.logger.Info("zero-trust policy added", zap.String("name", policy.Name))
}

func (zt *ZeroTrustManager) Authenticate(ctx context.Context, identity *VerifiableIdentity, resource string, action string) error {
	zt.mu.RLock()
	defer zt.mu.RUnlock()

	if time.Now().After(identity.ExpiresAt) {
		return fmt.Errorf("identity expired at %s", identity.ExpiresAt.Format(time.RFC3339))
	}

	var matchedPolicy *ZeroTrustPolicy
	for _, policy := range zt.policies {
		matchedPolicy = policy
		break
	}

	if matchedPolicy == nil {
		return fmt.Errorf("no matching policy for resource: %s", resource)
	}

	if matchedPolicy.VerifyIdentity {
		if identity.Type == "" || identity.ID == "" {
			return fmt.Errorf("identity verification failed: missing claims")
		}
	}

	if matchedPolicy.VerifyDevice {
		deviceID, ok := identity.Claims["device_id"]
		if !ok || deviceID == "" {
			return fmt.Errorf("device verification failed: no device attestation")
		}
	}

	if matchedPolicy.VerifyContext {
		if !zt.verifyContext(ctx, identity) {
			return fmt.Errorf("context verification failed")
		}
	}

	zt.logger.Info("authentication passed",
		zap.String("identity", identity.ID),
		zap.String("resource", resource),
		zap.String("action", action),
	)

	return nil
}

func (zt *ZeroTrustManager) verifyContext(ctx context.Context, identity *VerifiableIdentity) bool {
	// Check time-based access
	hour := time.Now().Hour()
	if hour < 6 || hour > 22 {
		zt.logger.Warn("access outside allowed hours", zap.Int("hour", hour))
	}

	// Check session limits
	if len(zt.sessions) > 10000 {
		zt.logger.Warn("session limit approaching")
	}

	return true
}

func (zt *ZeroTrustManager) CreateSession(identity *VerifiableIdentity) {
	zt.mu.Lock()
	defer zt.mu.Unlock()
	zt.sessions[identity.ID] = identity
}

func (zt *ZeroTrustManager) RevokeSession(identityID string) {
	zt.mu.Lock()
	defer zt.mu.Unlock()
	delete(zt.sessions, identityID)
}

func (zt *ZeroTrustManager) AttestNode(nodeID, platform, bootHash, kernelHash string) *AttestationReport {
	report := &AttestationReport{
		NodeID:     nodeID,
		Platform:   platform,
		BootHash:   bootHash,
		KernelHash: kernelHash,
		Timestamp:  time.Now(),
		Verified:   true,
	}

	knownBootHashes := map[string]bool{
		"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855": true,
	}
	knownKernelHashes := map[string]bool{
		"sha256:cdc76b5a15c15fc5cc25309e4e5bb67d91a4c5de7b4928b44616b53d235b8e43": true,
	}

	if !knownBootHashes[bootHash] {
		report.Verified = false
		report.Violations = append(report.Violations, "unknown boot hash")
	}

	if !knownKernelHashes[kernelHash] {
		report.Verified = false
		report.Violations = append(report.Violations, "unknown kernel hash")
	}

	zt.logger.Info("node attestation",
		zap.String("node", nodeID),
		zap.Bool("verified", report.Verified),
	)

	return report
}

func (zt *ZeroTrustManager) ContinuousVerification(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			zt.mu.RLock()
			for id, session := range zt.sessions {
				if time.Now().After(session.ExpiresAt) {
					zt.logger.Info("session expired", zap.String("session", id))
				}
			}
			zt.mu.RUnlock()
		}
	}
}

func (zt *ZeroTrustManager) GetTLSConfig() *tls.Config {
	return zt.tlsConfig
}

func (zt *ZeroTrustManager) LoadCACert(caCertPath string) error {
	caCert, err := os.ReadFile(caCertPath)
	if err != nil {
		return fmt.Errorf("read CA cert: %w", err)
	}

	caCertPool := x509.NewCertPool()
	if !caCertPool.AppendCertsFromPEM(caCert) {
		return fmt.Errorf("failed to parse CA certificate")
	}

	zt.tlsConfig.ClientCAs = caCertPool
	zt.tlsConfig.RootCAs = caCertPool

	zt.logger.Info("CA certificate loaded", zap.String("path", caCertPath))
	return nil
}
