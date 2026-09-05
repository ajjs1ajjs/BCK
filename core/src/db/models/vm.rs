use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct VmModel {
    pub id: String,
    pub name: String,
    pub hypervisor_id: String,
    pub mo_ref: String,
    pub power_state: Option<String>,
    pub os: Option<String>,
    pub cpu_count: i32,
    pub ram_mb: i64,
    pub disk_gb: i64,
    pub protection_status: String,
    pub last_backup: Option<i64>,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
