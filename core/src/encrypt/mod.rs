use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{Result, anyhow};
use chacha20poly1305::ChaCha20Poly1305;
use sha2::{Digest, Sha256};
use crate::types::EncryptionAlgorithm;

pub trait Encryptor: Send + Sync {
    fn encrypt(&self, data: &[u8], key: &[u8]) -> Result<EncryptedData>;
    fn decrypt(&self, data: &EncryptedData, key: &[u8]) -> Result<Vec<u8>>;
    fn algorithm(&self) -> &'static str;
    fn key_size(&self) -> usize;
}

#[derive(Debug, Clone)]
pub struct EncryptedData {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub algorithm: String,
    pub key_check: [u8; 8],
}

pub struct Aes256GcmEncryptor;

impl Aes256GcmEncryptor {
    fn aes_encrypt(data: &[u8], key: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
        use aes_gcm::aead::OsRng;
        use aes_gcm::aead::AeadCore;

        let key = ensure_key_size::<32>(key);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| anyhow!("AES key init error: {:?}", e))?;

        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, data)
            .map_err(|e| anyhow!("AES encrypt error: {:?}", e))?;

        Ok((ciphertext, nonce.to_vec()))
    }

    fn aes_decrypt(data: &[u8], key: &[u8], nonce: &[u8]) -> Result<Vec<u8>> {
        let key = ensure_key_size::<32>(key);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| anyhow!("AES key init error: {:?}", e))?;

        let nonce_ref = Nonce::from_slice(nonce);
        let plaintext = cipher.decrypt(nonce_ref, data)
            .map_err(|e| anyhow!("AES decrypt error: {:?}", e))?;

        Ok(plaintext)
    }
}

impl Encryptor for Aes256GcmEncryptor {
    fn encrypt(&self, data: &[u8], key: &[u8]) -> Result<EncryptedData> {
        let (ciphertext, nonce) = Self::aes_encrypt(data, key)?;
        let key_check = Sha256::digest(&ensure_key_size::<32>(key))[..8].try_into().unwrap();

        Ok(EncryptedData {
            ciphertext,
            nonce,
            algorithm: "aes-256-gcm".into(),
            key_check,
        })
    }

    fn decrypt(&self, data: &EncryptedData, key: &[u8]) -> Result<Vec<u8>> {
        Self::aes_decrypt(&data.ciphertext, key, &data.nonce)
    }

    fn algorithm(&self) -> &'static str { "aes-256-gcm" }
    fn key_size(&self) -> usize { 32 }
}

pub struct ChaCha20Encryptor;

impl ChaCha20Encryptor {
    fn chacha_encrypt(data: &[u8], key: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
        use chacha20poly1305::aead::{AeadCore, OsRng};

        let key = ensure_key_size::<32>(key);
        let cipher = ChaCha20Poly1305::new_from_slice(&key)
            .map_err(|e| anyhow!("ChaCha key init error: {:?}", e))?;

        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, data)
            .map_err(|e| anyhow!("ChaCha encrypt error: {:?}", e))?;

        Ok((ciphertext, nonce.to_vec()))
    }

    fn chacha_decrypt(data: &[u8], key: &[u8], nonce: &[u8]) -> Result<Vec<u8>> {
        use chacha20poly1305::aead::Aead;
        use chacha20poly1305::aead::generic_array::GenericArray;

        let key = ensure_key_size::<32>(key);
        let cipher = ChaCha20Poly1305::new_from_slice(&key)
            .map_err(|e| anyhow!("ChaCha key init error: {:?}", e))?;

        let nonce_ref = GenericArray::from_slice(nonce);
        let plaintext = cipher.decrypt(nonce_ref, data)
            .map_err(|e| anyhow!("ChaCha decrypt error: {:?}", e))?;

        Ok(plaintext)
    }
}

impl Encryptor for ChaCha20Encryptor {
    fn encrypt(&self, data: &[u8], key: &[u8]) -> Result<EncryptedData> {
        let (ciphertext, nonce) = Self::chacha_encrypt(data, key)?;
        let key_check = Sha256::digest(&ensure_key_size::<32>(key))[..8].try_into().unwrap();

        Ok(EncryptedData {
            ciphertext,
            nonce,
            algorithm: "chacha20-poly1305".into(),
            key_check,
        })
    }

    fn decrypt(&self, data: &EncryptedData, key: &[u8]) -> Result<Vec<u8>> {
        Self::chacha_decrypt(&data.ciphertext, key, &data.nonce)
    }

    fn algorithm(&self) -> &'static str { "chacha20-poly1305" }
    fn key_size(&self) -> usize { 32 }
}

fn ensure_key_size<const N: usize>(key: &[u8]) -> [u8; N] {
    if key.len() >= N {
        let mut result = [0u8; N];
        result.copy_from_slice(&key[..N]);
        result
    } else {
        let hash = Sha256::digest(key);
        let mut result = [0u8; N];
        result.copy_from_slice(&hash[..N]);
        result
    }
}

pub fn create_encryptor(algorithm: &EncryptionAlgorithm) -> Box<dyn Encryptor> {
    match algorithm {
        EncryptionAlgorithm::Aes256Gcm => Box::new(Aes256GcmEncryptor),
        EncryptionAlgorithm::ChaCha20Poly1305 => Box::new(ChaCha20Encryptor),
        EncryptionAlgorithm::None => panic!("No encryptor for None algorithm"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_KEY: &[u8; 32] = b"BCK_TEST_KEY_32_BYTES_LONG____!!";

    #[test]
    fn test_aes256_roundtrip() {
        let encryptor = Aes256GcmEncryptor;
        let data = b"Hello, BCK backup system!";
        let encrypted = encryptor.encrypt(data, TEST_KEY).unwrap();
        assert_ne!(encrypted.ciphertext, data);
        assert_eq!(encrypted.nonce.len(), 12);
        assert_eq!(encrypted.algorithm, "aes-256-gcm");
        let decrypted = encryptor.decrypt(&encrypted, TEST_KEY).unwrap();
        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_chacha20_roundtrip() {
        let encryptor = ChaCha20Encryptor;
        let data = b"BCK ChaCha20 test data";
        let encrypted = encryptor.encrypt(data, TEST_KEY).unwrap();
        assert_ne!(encrypted.ciphertext, data);
        assert_eq!(encrypted.algorithm, "chacha20-poly1305");
        let decrypted = encryptor.decrypt(&encrypted, TEST_KEY).unwrap();
        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_aes256_large_data() {
        let encryptor = Aes256GcmEncryptor;
        let data = vec![0xABu8; 1024 * 100];
        let encrypted = encryptor.encrypt(&data, TEST_KEY).unwrap();
        let decrypted = encryptor.decrypt(&encrypted, TEST_KEY).unwrap();
        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_wrong_key_fails() {
        let encryptor = Aes256GcmEncryptor;
        let wrong_key = b"WRONG_KEY_32_BYTES_FOR_TEST____!";
        let data = b"sensitive data";
        let encrypted = encryptor.encrypt(data, TEST_KEY).unwrap();
        let result = encryptor.decrypt(&encrypted, wrong_key);
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let encryptor = Aes256GcmEncryptor;
        let data = b"important backup data";
        let mut encrypted = encryptor.encrypt(data, TEST_KEY).unwrap();
        encrypted.ciphertext[0] ^= 0xFF;
        let result = encryptor.decrypt(&encrypted, TEST_KEY);
        assert!(result.is_err());
    }

    #[test]
    fn test_key_check_consistency() {
        let encryptor = Aes256GcmEncryptor;
        let data = b"test";
        let e1 = encryptor.encrypt(data, TEST_KEY).unwrap();
        let e2 = encryptor.encrypt(data, TEST_KEY).unwrap();
        assert_eq!(e1.key_check, e2.key_check);
    }

    #[test]
    fn test_create_encryptors() {
        let aes = create_encryptor(&EncryptionAlgorithm::Aes256Gcm);
        assert_eq!(aes.algorithm(), "aes-256-gcm");
        let chacha = create_encryptor(&EncryptionAlgorithm::ChaCha20Poly1305);
        assert_eq!(chacha.algorithm(), "chacha20-poly1305");
    }
}
