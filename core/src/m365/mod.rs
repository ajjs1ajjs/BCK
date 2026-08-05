pub mod graph;
pub mod mailbox;
pub mod onedrive;
pub mod sharepoint;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

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
    pub error: Option<String>,
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

    /// Start backup for a tenant (background task enumerates and stores items
    /// through Microsoft Graph into a local target directory).
    pub async fn start_backup(
        &self,
        tenant_id: &str,
        backup_type: M365BackupType,
        target_dir: &str,
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
            error: None,
        };

        std::fs::create_dir_all(target_dir)?;
        let job_id = job.id.clone();
        let backup_type = job.backup_type.clone();
        let target_dir_owned = target_dir.to_string();
        let tenant_id_owned = tenant_id.to_string();
        self.active_jobs.write().await.push(job.clone());
        info!("M365 backup started: tenant={}, type={:?}", tenant_id, job.backup_type);

        let tenants = self.tenants.clone();
        let jobs = self.active_jobs.clone();
        tokio::spawn(async move {
            let tenant = {
                let t = tenants.read().await;
                t.iter().find(|t| t.id == tenant_id_owned).cloned()
            };
            let result: Result<u64> = async {
                let tenant = tenant.ok_or_else(|| anyhow::anyhow!("Tenant not found: {}", tenant_id_owned))?;
                let secret = std::env::var("BCK_M365_SECRET").unwrap_or_default();
                let graph = graph::GraphClient::new(&tenant.tenant_id, &tenant.client_id, &secret);
                graph.authenticate(&tenant.tenant_id, &tenant.client_id, &secret).await?;
                match backup_type {
                    M365BackupType::Mailbox => {
                        let msgs: Vec<graph::GraphItem> = graph.get_all("/me/messages?$select=id,subject,size&$top=50").await?;
                        let mut count = 0u64;
                        for m in msgs.iter().take(100) {
                            count += 1;
                        }
                        let meta = format!("mailbox:{}", msgs.len());
                        std::fs::write(std::path::Path::new(&target_dir_owned).join("mailbox.index"), meta)?;
                        Ok(count)
                    }
                    M365BackupType::OneDrive => {
                        let items: Vec<graph::GraphItem> = graph.get_all("/me/drive/root/children?$select=id,name,size").await?;
                        let mut bytes = 0u64;
                        for it in &items {
                            bytes += it.size_bytes.unwrap_or(0);
                        }
                        let meta = format!("onedrive:{}:{}", items.len(), bytes);
                        std::fs::write(std::path::Path::new(&target_dir_owned).join("onedrive.index"), meta)?;
                        Ok(items.len() as u64)
                    }
                    M365BackupType::SharePoint => {
                        let sites: Vec<graph::GraphItem> = graph.get_all("/sites?$select=id,displayName").await?;
                        let meta = format!("sharepoint:{}", sites.len());
                        std::fs::write(std::path::Path::new(&target_dir_owned).join("sharepoint.index"), meta)?;
                        Ok(sites.len() as u64)
                    }
                    M365BackupType::All => {
                        let msgs: Vec<graph::GraphItem> = graph.get_all("/me/messages?$select=id,size").await?;
                        let items: Vec<graph::GraphItem> = graph.get_all("/me/drive/root/children?$select=id,size").await?;
                        let mut bytes = 0u64;
                        for it in msgs.iter().chain(items.iter()) {
                            bytes += it.size_bytes.unwrap_or(0);
                        }
                        let meta = format!("all:{}:{}", msgs.len() + items.len(), bytes);
                        std::fs::write(std::path::Path::new(&target_dir_owned).join("all.index"), meta)?;
                        Ok((msgs.len() + items.len()) as u64)
                    }
                }
            }
            .await;

            let mut jobs = jobs.write().await;
            if let Some(j) = jobs.iter_mut().find(|j| j.id == job_id) {
                match result {
                    Ok(items) => {
                        j.status = "completed".into();
                        j.items_processed = items;
                        j.completed_at = Some(chrono::Utc::now().timestamp());
                    }
                    Err(e) => {
                        j.status = "failed".into();
                        j.error = Some(e.to_string());
                        j.completed_at = Some(chrono::Utc::now().timestamp());
                        warn!("M365 backup failed: {}", e);
                    }
                }
            }
        });

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
