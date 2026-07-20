pub mod jwt;

use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub role: UserRole,
    pub email: Option<String>,
    pub enabled: bool,
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

pub fn hash_password(password: &str) -> String {
    let hash = Sha256::digest(password.as_bytes());
    hex::encode(hash)
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    hash_password(password) == hash
}

pub fn generate_api_key() -> String {
    Uuid::new_v4().to_string()
}
