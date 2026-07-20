pub mod graph;
pub mod mailbox;
pub mod onedrive;
pub mod sharepoint;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct M365Tenant {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub auth_type: AuthType,
    pub client_id: String,
    pub encrypted_secret: String,
    pub status: TenantStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AuthType {
    AppOnly,
    Delegated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TenantStatus {
    Connected,
    Disconnected,
    AuthExpired,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct M365BackupJob {
    pub id: String,
    pub tenant_id: String,
    pub backup_type: M365BackupType,
    pub status: String,
    pub items_processed: u64,
    pub bytes_processed: u64,
    pub started_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum M365BackupType {
    Mailbox,
    OneDrive,
    SharePoint,
    All,
}

/// M365 backup manager
pub struct M365BackupManager {
    tenants: Arc<RwLock<Vec<M365Tenant>>>,
    active_jobs: Arc<RwLock<Vec<M365BackupJob>>>,
}

impl M365BackupManager {
    pub fn new() -> Self {
        Self {
            tenants: Arc::new(RwLock::new(Vec::new())),
            active_jobs: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Register a tenant
    pub async fn register_tenant(&self, tenant: M365Tenant) -> Result<M365Tenant> {
        let mut tenants = self.tenants.write().await;
        let tenant = M365Tenant {
            id: uuid::Uuid::new_v4().to_string(),
            ..tenant
        };
        info!("M365 tenant registered: {} ({})", tenant.name, tenant.tenant_id);
        tenants.push(tenant.clone());
        Ok(tenant)
    }

    /// Start backup for a tenant
    pub async fn start_backup(
        &self,
        tenant_id: &str,
        backup_type: M365BackupType,
    ) -> Result<M365BackupJob> {
        let job = M365BackupJob {
            id: uuid::Uuid::new_v4().to_string(),
            tenant_id: tenant_id.to_string(),
            backup_type,
            status: "running".into(),
            items_processed: 0,
            bytes_processed: 0,
            started_at: chrono::Utc::now().timestamp(),
            completed_at: None,
        };

        self.active_jobs.write().await.push(job.clone());
        info!("M365 backup started: tenant={}, type={:?}", tenant_id, job.backup_type);
        Ok(job)
    }

    /// List all tenants
    pub async fn list_tenants(&self) -> Vec<M365Tenant> {
        self.tenants.read().await.clone()
    }

    /// List backup jobs
    pub async fn list_jobs(&self) -> Vec<M365BackupJob> {
        self.active_jobs.read().await.clone()
    }
}
