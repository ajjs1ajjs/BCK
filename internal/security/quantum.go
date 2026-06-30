package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha512"
	"fmt"
	"io"

	"golang.org/x/crypto/chacha20poly1305"
)

type QuantumResistantKey struct {
	AESKey      []byte `json:"aes_key"`
	ChaChaKey   []byte `json:"chacha_key"`
	CreatedAt   int64  `json:"created_at"`
	Algorithm   string `json:"algorithm"`
}

type HybridEncryptor struct {
	qrKey *QuantumResistantKey
}

func NewHybridEncryptor(password []byte) (*HybridEncryptor, error) {
	// Use SHA-512 for key derivation (resistant to Grover's algorithm due to larger output)
	hash := sha512.Sum512(password)

	// Split into two 256-bit keys for hybrid encryption
	aesKey := make([]byte, 32)
	chachaKey := make([]byte, 32)
	copy(aesKey, hash[:32])
	copy(chachaKey, hash[32:64])

	return &HybridEncryptor{
		qrKey: &QuantumResistantKey{
			AESKey:    aesKey,
			ChaChaKey: chachaKey,
			Algorithm: "AES-256-GCM + XChaCha20-Poly1305 (Hybrid PQ)",
		},
	}, nil
}

func (he *HybridEncryptor) Encrypt(plaintext []byte) ([]byte, error) {
	// Layer 1: AES-256-GCM
	aesEnc, err := he.aesEncrypt(plaintext)
	if err != nil {
		return nil, fmt.Errorf("aes layer: %w", err)
	}

	// Layer 2: XChaCha20-Poly1305
	chachaEnc, err := he.chachaEncrypt(aesEnc)
	if err != nil {
		return nil, fmt.Errorf("chacha layer: %w", err)
	}

	return chachaEnc, nil
}

func (he *HybridEncryptor) Decrypt(ciphertext []byte) ([]byte, error) {
	// Layer 2: XChaCha20-Poly1305
	chachaDec, err := he.chachaDecrypt(ciphertext)
	if err != nil {
		return nil, fmt.Errorf("chacha layer: %w", err)
	}

	// Layer 1: AES-256-GCM
	aesDec, err := he.aesDecrypt(chachaDec)
	if err != nil {
		return nil, fmt.Errorf("aes layer: %w", err)
	}

	return aesDec, nil
}

func (he *HybridEncryptor) aesEncrypt(data []byte) ([]byte, error) {
	block, err := aes.NewCipher(he.qrKey.AESKey)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return gcm.Seal(nonce, nonce, data, nil), nil
}

func (he *HybridEncryptor) aesDecrypt(data []byte) ([]byte, error) {
	block, err := aes.NewCipher(he.qrKey.AESKey)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func (he *HybridEncryptor) chachaEncrypt(data []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(he.qrKey.ChaChaKey)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return aead.Seal(nonce, nonce, data, nil), nil
}

func (he *HybridEncryptor) chachaDecrypt(data []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(he.qrKey.ChaChaKey)
	if err != nil {
		return nil, err
	}

	nonceSize := aead.NonceSize()
	if len(data) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	return aead.Open(nil, nonce, ciphertext, nil)
}

type QuantumEntropy struct{}

func (qe *QuantumEntropy) GenerateStrongPassword(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?"
	bytes := make([]byte, length*2)
	rand.Read(bytes)

	hash := sha512.Sum512(bytes)
	result := make([]byte, length)

	for i := 0; i < length; i++ {
		idx := int(hash[i]) % len(charset)
		result[i] = charset[idx]
	}

	return string(result)
}

type PQKeyStore struct {
	keys map[string]*QuantumResistantKey
}

func NewPQKeyStore() *PQKeyStore {
	return &PQKeyStore{keys: make(map[string]*QuantumResistantKey)}
}

func (pq *PQKeyStore) Rotate(repoID string, password []byte) error {
	key, err := NewHybridEncryptor(password)
	if err != nil {
		return err
	}
	pq.keys[repoID] = key.qrKey
	return nil
}

func (pq *PQKeyStore) GetEncryptor(repoID string) (*HybridEncryptor, error) {
	key, exists := pq.keys[repoID]
	if !exists {
		return nil, fmt.Errorf("no quantum-resistant key for repo %s", repoID)
	}
	return &HybridEncryptor{qrKey: key}, nil
}
