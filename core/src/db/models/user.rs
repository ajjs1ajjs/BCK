use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserModel {
    pub id: String,
    pub username: String,
    pub password_hash: String,
    pub email: Option<String>,
    pub role: String,
    #[sqlx(try_from = "i64")]
    pub enabled: bool,
    pub last_login: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// NULL for global/system accounts (and single-tenant deployments).
    pub tenant_id: Option<String>,
}
