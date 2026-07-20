use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SnapshotModel {
    pub id: String,
    pub job_id: String,
    pub session_id: String,
    pub repository_id: String,
    pub snapshot_type: String,
    pub parent_id: Option<String>,
    pub size_bytes: i64,
    pub unique_bytes: i64,
    pub compressed_bytes: i64,
    pub checksum: String,
    pub consistency: String,
    pub app_consistent: bool,
    pub created_at: i64,
}
