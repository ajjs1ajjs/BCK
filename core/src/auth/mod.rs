pub mod jwt;

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    password_hash::rand_core::{OsRng, RngCore},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub role: UserRole,
    pub email: Option<String>,
    pub enabled: bool,
    /// NULL for global/system accounts (and single-tenant deployments).
    #[serde(default)]
    pub tenant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UserRole {
    SuperAdmin,
    Admin,
    Operator,
    RestoreOperator,
    Viewer,
}

impl std::fmt::Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserRole::SuperAdmin => write!(f, "super_admin"),
            UserRole::Admin => write!(f, "admin"),
            UserRole::Operator => write!(f, "operator"),
            UserRole::RestoreOperator => write!(f, "restore_operator"),
            UserRole::Viewer => write!(f, "viewer"),
        }
    }
}

impl UserRole {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "super_admin" => Some(Self::SuperAdmin),
            "admin" => Some(Self::Admin),
            "operator" => Some(Self::Operator),
            "restore_operator" => Some(Self::RestoreOperator),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }
}

/// Hash a password with Argon2id (memory-hard, salted, per-call random salt).
/// The output is a PHC string (`$argon2id$...`) that carries salt + params.
pub fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .unwrap_or_default()
}

/// Verify a password against a stored hash. Supports both Argon2id PHC strings
/// (new accounts) and legacy unsalted SHA-256 hex digests (accounts created
/// before the migration). Legacy hashes are compared in constant time and are
/// re-hashed to Argon2id on successful login by callers that choose to.
pub fn verify_password(password: &str, hash: &str) -> bool {
    if hash.is_empty() {
        return false;
    }
    if hash.starts_with("$argon2") {
        match PasswordHash::new(hash) {
            Ok(parsed) => Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok(),
            Err(_) => false,
        }
    } else {
        let computed = sha256_hex(password);
        constant_time_eq(computed.as_bytes(), hash.as_bytes())
    }
}

fn sha256_hex(password: &str) -> String {
    let digest = Sha256::digest(password.as_bytes());
    hex::encode(digest)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn generate_api_key() -> String {
    Uuid::new_v4().to_string()
}

/// Fill a buffer with cryptographically secure random bytes.
pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; n];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

/// Generate a human-typable password from cryptographically secure random data.
pub fn generate_random_password(len: usize) -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    random_bytes(len)
        .iter()
        .map(|b| CHARS[(*b as usize) % CHARS.len()] as char)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_roundtrip() {
        let hash = hash_password("s3cret-pass");
        assert!(hash.starts_with("$argon2"));
        assert!(verify_password("s3cret-pass", &hash));
        assert!(!verify_password("wrong-pass", &hash));
    }

    #[test]
    fn argon2_is_salted_per_call() {
        let h1 = hash_password("same-password");
        let h2 = hash_password("same-password");
        assert_ne!(h1, h2, "password hashes must be salted per call");
        assert!(verify_password("same-password", &h1));
        assert!(verify_password("same-password", &h2));
    }

    #[test]
    fn legacy_sha256_still_verifies() {
        // Accounts created before the Argon2 migration stored unsalted SHA-256.
        let legacy = sha256_hex("old-password");
        assert!(verify_password("old-password", &legacy));
        assert!(!verify_password("wrong", &legacy));
    }

    #[test]
    fn empty_or_malformed_hash_fails() {
        assert!(!verify_password("password", ""));
        assert!(!verify_password("password", "not-a-real-hash"));
        assert!(!verify_password("password", "$argon2broken"));
    }

    #[test]
    fn generated_password_is_long_and_typable() {
        let p = generate_random_password(20);
        assert_eq!(p.len(), 20);
        assert!(p.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn random_bytes_are_not_all_zero() {
        let a = random_bytes(32);
        assert_eq!(a.len(), 32);
        assert!(a.iter().any(|&b| b != 0));
    }
}
