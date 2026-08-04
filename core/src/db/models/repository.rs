use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RepositoryModel {
    pub id: String,
    pub name: String,
    pub repo_type: String,
    pub config_json: String,
    pub capacity_bytes: i64,
    pub used_bytes: i64,
    pub free_bytes: i64,
    #[sqlx(try_from = "i64")]
    pub encrypted: bool,
    #[sqlx(try_from = "i64")]
    pub immutable: bool,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}
