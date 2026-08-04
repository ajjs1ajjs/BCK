use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AgentModel {
    pub id: String,
    pub hostname: String,
    pub ip_address: Option<String>,
    pub os_type: Option<String>,
    pub os_version: Option<String>,
    pub agent_version: Option<String>,
    pub status: String,
    pub last_seen: Option<i64>,
    pub capabilities: String,
    pub created_at: i64,
}
