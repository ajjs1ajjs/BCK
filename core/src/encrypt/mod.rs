use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{Result, anyhow};
use argon2::Argon2;
use base64::Engine;
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

/// Load a 32-byte encryption key from disk, generating and persisting one if
/// it does not exist yet. The key is derived (hashed) down to 32 bytes if the
/// stored material is shorter. The file is created with owner-only permissions
/// (0600) so other local users cannot read the key material.
pub fn load_or_create_key(path: &std::path::Path) -> Result<Vec<u8>> {
    load_key(path, None)
}

/// Like `load_or_create_key`, but wraps the key at rest with a passphrase.
/// When `passphrase` is set the stored key file is encrypted with a key derived
/// from it via Argon2id; reading the file alone (or a backup-data compromise)
/// is no longer sufficient to recover the key. A raw pre-existing key file is
/// migrated to the wrapped format on next load.
pub fn load_key(path: &std::path::Path, passphrase: Option<&str>) -> Result<Vec<u8>> {
    if path.exists() {
        let raw = std::fs::read(path)?;
        if !raw.is_empty() {
            tighten_permissions(path);
            if is_wrapped(&raw) {
                let pass = passphrase.ok_or_else(|| {
                    anyhow!("encryption key is passphrase-protected but no passphrase is configured (set encryption.passphrase)")
                })?;
                return unwrap_key(&raw, pass);
            }
            // Raw key: migrate to the wrapped format when a passphrase is set.
            if let Some(pass) = passphrase {
                if raw.len() == 32 {
                    let wrapped = wrap_key(&raw, pass)?;
                    std::fs::remove_file(path).ok();
                    write_key_file(path, &wrapped)?;
                    return Ok(raw);
                }
            }
            return Ok(raw);
        }
    }

    let mut key = vec![0u8; 32];
    use aes_gcm::aead::OsRng;
    use aes_gcm::aead::rand_core::RngCore;
    OsRng.fill_bytes(&mut key);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    match passphrase {
        Some(pass) => write_key_file(path, &wrap_key(&key, pass)?)?,
        None => write_key_file(path, &key)?,
    }
    Ok(key)
}

// --- passphrase wrapping ---

const WRAP_MAGIC: &[u8; 8] = b"BCKW1\0\0\0";
const WRAP_SALT_LEN: usize = 16;
const WRAP_NONCE_LEN: usize = 12;

fn is_wrapped(data: &[u8]) -> bool {
    data.len() >= WRAP_MAGIC.len() + WRAP_SALT_LEN + WRAP_NONCE_LEN + 32 && data.starts_with(WRAP_MAGIC)
}

fn derive_wrap_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32]> {
    let mut out = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut out)
        .map_err(|e| anyhow!("encryption key derivation failed: {}", e))?;
    Ok(out)
}

fn wrap_key(key: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    use aes_gcm::aead::{Aead, AeadCore, OsRng};
    use aes_gcm::aead::rand_core::RngCore;
    use aes_gcm::Nonce;

    let mut salt = [0u8; WRAP_SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let wrap_key = derive_wrap_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&wrap_key)
        .map_err(|e| anyhow!("wrap cipher init: {:?}", e))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), key)
        .map_err(|e| anyhow!("key wrap failed: {:?}", e))?;

    let mut blob = Vec::with_capacity(WRAP_MAGIC.len() + WRAP_SALT_LEN + WRAP_NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(WRAP_MAGIC);
    blob.extend_from_slice(&salt);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

fn unwrap_key(blob: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    use aes_gcm::aead::Aead;
    use aes_gcm::Nonce;

    let salt_start = WRAP_MAGIC.len();
    let nonce_start = salt_start + WRAP_SALT_LEN;
    if blob.len() <= nonce_start + WRAP_NONCE_LEN {
        return Err(anyhow!("corrupted wrapped encryption key"));
    }
    let salt = &blob[salt_start..nonce_start];
    let nonce = &blob[nonce_start..nonce_start + WRAP_NONCE_LEN];
    let ciphertext = &blob[nonce_start + WRAP_NONCE_LEN..];

    let wrap_key = derive_wrap_key(passphrase, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&wrap_key)
        .map_err(|e| anyhow!("unwrap cipher init: {:?}", e))?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| anyhow!("failed to unwrap encryption key: wrong passphrase or corrupted file"))
}

fn tighten_permissions(_path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(perm) = std::fs::metadata(_path) {
            if perm.permissions().mode() & 0o077 != 0 {
                let _ = std::fs::set_permissions(_path, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
}

fn write_key_file(path: &std::path::Path, key: &[u8]) -> Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| anyhow!("create key file: {}", e))?;
        f.write_all(key).map_err(|e| anyhow!("write key file: {}", e))?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, key).map_err(|e| anyhow!("write key file: {}", e))
    }
}

/// Where the encryption key is stored when `encryption.key_path` is unset.
/// Lives outside the backups directory so a compromise of backup data alone
/// does not also hand over the key.
pub fn default_key_path(config: &crate::config::AppConfig) -> std::path::PathBuf {
    config
        .storage
        .default_path
        .parent()
        .unwrap_or(&config.storage.default_path)
        .join("keys")
        .join("encryption.key")
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

/// Load the application encryption key for a config (the same key used for
/// block data). Creates and persists it on first use.
pub fn app_key(config: &crate::config::AppConfig) -> Result<Vec<u8>> {
    let key_path = config.encryption.key_path.clone()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| default_key_path(config));
    load_key(&key_path, config.encryption.passphrase.as_deref())
}

/// Encrypt a small credential (cloud secret, hypervisor password, connection
/// string) for storage at rest. Format: `enc:` + base64url(nonce || ct).
/// Uses the application key, so a DB-file compromise alone is not enough to
/// recover the secret when the key is passphrase-wrapped.
pub fn encrypt_secret(key: &[u8], plaintext: &str) -> Result<String> {
    use aes_gcm::aead::{Aead, OsRng};
    use aes_gcm::aead::rand_core::RngCore;
    use aes_gcm::Nonce;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;

    let cipher = Aes256Gcm::new_from_slice(&ensure_key_size::<32>(key))
        .map_err(|e| anyhow!("secret cipher init: {:?}", e))?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|e| anyhow!("secret encrypt failed: {:?}", e))?;

    let mut blob = Vec::with_capacity(12 + ct.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ct);
    Ok(format!("enc:{}", B64.encode(blob)))
}

/// Decrypt a value produced by `encrypt_secret`. Values without the `enc:`
/// prefix are returned unchanged so previously stored plaintext credentials
/// keep working until rewritten.
pub fn decrypt_secret(key: &[u8], blob: &str) -> Result<String> {
    use aes_gcm::aead::Aead;
    use aes_gcm::Nonce;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;

    let Some(payload) = blob.strip_prefix("enc:") else {
        return Ok(blob.to_string());
    };
    let raw = B64.decode(payload).map_err(|e| anyhow!("secret decode failed: {e}"))?;
    if raw.len() < 12 {
        anyhow::bail!("corrupted encrypted secret");
    }
    let cipher = Aes256Gcm::new_from_slice(&ensure_key_size::<32>(key))
        .map_err(|e| anyhow!("secret cipher init: {:?}", e))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&raw[..12]), &raw[12..])
        .map_err(|_| anyhow!("failed to decrypt secret: wrong key or corrupted value"))?;
    String::from_utf8(plaintext).map_err(|e| anyhow!("secret is not valid utf8: {e}"))
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

    #[test]
    fn test_key_passphrase_roundtrip() {
        let dir = std::env::temp_dir().join(format!("bck-key-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("enc.key");

        // Create a wrapped key with a passphrase.
        let key1 = load_key(&path, Some("hunter2")).unwrap();
        assert_eq!(key1.len(), 32);
        let blob = std::fs::read(&path).unwrap();
        assert!(is_wrapped(&blob), "key file must be wrapped");

        // Loading with the correct passphrase returns the same key.
        let key2 = load_key(&path, Some("hunter2")).unwrap();
        assert_eq!(key1, key2);

        // Wrong passphrase must fail.
        assert!(load_key(&path, Some("wrong")).is_err());

        // No passphrase on a wrapped file must fail loudly.
        assert!(load_key(&path, None).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_raw_key_migrates_to_wrapped() {
        let dir = std::env::temp_dir().join(format!("bck-key-mig-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("enc.key");

        // Create a raw key first (no passphrase).
        let raw = load_key(&path, None).unwrap();
        assert!(!is_wrapped(&std::fs::read(&path).unwrap()));

        // Loading again with a passphrase migrates the file to wrapped and
        // keeps the same key material.
        let key = load_key(&path, Some("p@ss")).unwrap();
        assert_eq!(key, raw);
        assert!(is_wrapped(&std::fs::read(&path).unwrap()));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_secret_roundtrip() {
        let key = TEST_KEY;
        let blob = encrypt_secret(key, "s3cr3t-credential").unwrap();
        assert!(blob.starts_with("enc:"), "must be marked as encrypted");
        assert!(!blob.contains("s3cr3t"), "ciphertext must not contain the plaintext");
        assert_eq!(decrypt_secret(key, &blob).unwrap(), "s3cr3t-credential");
    }

    #[test]
    fn test_secret_wrong_key_fails() {
        let blob = encrypt_secret(TEST_KEY, "hunter2").unwrap();
        let wrong = b"WRONG_KEY_32_BYTES_FOR_TEST____!";
        assert!(decrypt_secret(wrong, &blob).is_err());
    }

    #[test]
    fn test_secret_legacy_plaintext_passthrough() {
        // Previously stored plaintext credentials must keep working.
        assert_eq!(decrypt_secret(TEST_KEY, "legacy-plaintext").unwrap(), "legacy-plaintext");
        assert!(decrypt_secret(TEST_KEY, "").unwrap().is_empty());
    }
}
