use crate::db::DbPool;
use anyhow::Result;
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
    /// NULL = global/system repository.
    pub tenant_id: Option<String>,
}

impl RepositoryModel {
    /// Fetch a single repository by id. Used by the hypervisor VM backup
    /// authorization check (SEC-018): the target repository must belong to
    /// the caller's tenant.
    pub async fn fetch_by_id(db: &DbPool, id: &str) -> Result<Option<Self>> {
        match db {
            DbPool::Sqlite(pool) => {
                let row = sqlx::query_as::<_, Self>(
                    "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                            free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
                     FROM repositories WHERE id = ?1",
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;
                Ok(row)
            }
            DbPool::Postgres(pool) => {
                let row = sqlx::query_as::<_, Self>(
                    "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                            free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
                     FROM repositories WHERE id = $1",
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;
                Ok(row)
            }
        }
    }
}
