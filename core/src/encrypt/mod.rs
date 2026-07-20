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
