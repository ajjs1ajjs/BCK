use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BackupJobModel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub job_type: String,
    pub backup_type: String,
    pub source_config: String,
    pub repository_id: String,
    pub schedule: Option<String>,
    pub retention_config: String,
    pub compression: String,
    pub encryption: bool,
    pub bandwidth_limit: Option<i64>,
    pub enabled: bool,
    pub last_run_at: Option<i64>,
    pub next_run_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct JobSessionModel {
    pub id: String,
    pub job_id: String,
    pub status: String,
    pub backup_type: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub total_bytes: i64,
    pub processed_bytes: i64,
    pub transferred_bytes: i64,
    pub dedup_ratio: Option<f64>,
    pub compression_ratio: Option<f64>,
    pub files_processed: i64,
    pub warnings_count: i32,
    pub errors_count: i32,
    pub error_message: Option<String>,
    pub created_at: i64,
}
