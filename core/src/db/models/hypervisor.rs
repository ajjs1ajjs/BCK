use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct HypervisorModel {
    pub id: String,
    pub name: String,
    pub hv_type: String,
    pub host: String,
    pub port: i32,
    pub credentials_json: String,
    pub ssl_thumbprint: Option<String>,
    pub status: String,
    pub version: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
