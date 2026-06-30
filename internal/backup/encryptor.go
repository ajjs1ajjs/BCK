package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
)

type Encryptor struct {
	key []byte
}

func NewEncryptor(key []byte) (*Encryptor, error) {
	if len(key) != 32 {
		key = DeriveKey(key)
	}
	return &Encryptor{key: key}, nil
}

func DeriveKey(password []byte) []byte {
	salt := []byte("backup-manager-salt-v1")
	return argon2.IDKey(password, salt, 3, 64*1024, 4, 32)
}

func GenerateKey() ([]byte, string, error) {
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, "", fmt.Errorf("generate key: %w", err)
	}
	return key, hex.EncodeToString(key), nil
}

func KeyFromHex(hexKey string) ([]byte, error) {
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode key: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("invalid key length: expected 32 bytes")
	}
	return key, nil
}

func (e *Encryptor) Encrypt(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, nil
}

func (e *Encryptor) Decrypt(ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	return plaintext, nil
}

func (e *Encryptor) Key() []byte {
	return e.key
}
