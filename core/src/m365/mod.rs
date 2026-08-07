pub mod graph;
pub mod mailbox;
pub mod onedrive;
pub mod sharepoint;

use crate::m365::graph::{BackupStats, GraphClient};
use crate::m365::mailbox::{sanitize_filename, MailboxBackup};
use crate::m365::onedrive::OneDriveBackup;
use crate::m365::sharepoint::SharePointBackup;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct M365Tenant {
    #[serde(default)]
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
            backup_type: backup_type.clone(),
            status: "running".into(),
            items_processed: 0,
            bytes_processed: 0,
            started_at: chrono::Utc::now().timestamp(),
            completed_at: None,
        };

        let tenants = self.tenants.read().await;
        let tenant = tenants
            .iter()
            .find(|t| t.tenant_id == tenant_id)
            .cloned()
            .ok_or_else(|| anyhow!("M365 tenant not found: {}", tenant_id))?;
        drop(tenants);

        self.active_jobs.write().await.push(job.clone());
        info!(
            "M365 backup started: tenant={}, type={:?}",
            tenant_id, job.backup_type
        );

        let jobs = self.active_jobs.clone();
        let job_id = job.id.clone();

        tokio::spawn(async move {
            // NOTE: tenant.encrypted_secret is used as the plaintext client secret for now.
            // Decryption-at-rest (KMS) is handled later.
            let graph = GraphClient::new(
                tenant.tenant_id.clone(),
                tenant.client_id.clone(),
                tenant.encrypted_secret.clone(),
            );
            let backup_dir = std::env::temp_dir().join("bck-m365").join(&job_id);
            let result = run_backup(&graph, backup_type, &backup_dir).await;

            let mut jobs = jobs.write().await;
            if let Some(j) = jobs.iter_mut().find(|j| j.id == job_id) {
                match result {
                    Ok(stats) => {
                        j.status = "completed".into();
                        j.items_processed = stats.items;
                        j.bytes_processed = stats.bytes;
                    }
                    Err(e) => {
                        j.status = format!("failed: {}", e);
                    }
                }
                j.completed_at = Some(chrono::Utc::now().timestamp());
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

impl Default for M365BackupManager {
    fn default() -> Self {
        Self::new()
    }
}

async fn run_backup(
    graph: &GraphClient,
    backup_type: M365BackupType,
    backup_dir: &Path,
) -> Result<BackupStats> {
    match backup_type {
        M365BackupType::Mailbox => run_mailbox_backup(graph, backup_dir).await,
        M365BackupType::OneDrive => run_onedrive_backup(graph, backup_dir).await,
        M365BackupType::SharePoint => run_sharepoint_backup(graph, backup_dir).await,
        M365BackupType::All => {
            let mut total = BackupStats::default();
            for stats in [
                run_mailbox_backup(graph, backup_dir).await,
                run_onedrive_backup(graph, backup_dir).await,
                run_sharepoint_backup(graph, backup_dir).await,
            ] {
                let stats = stats?;
                total.items += stats.items;
                total.bytes += stats.bytes;
            }
            Ok(total)
        }
    }
}

async fn run_mailbox_backup(graph: &GraphClient, backup_dir: &Path) -> Result<BackupStats> {
    let mb = MailboxBackup::new(graph.clone());
    let mailboxes = mb.list_mailboxes().await?;
    let mut total = BackupStats::default();
    for m in &mailboxes {
        let dir = backup_dir
            .join("mailbox")
            .join(sanitize_filename(&m.id));
        let stats = mb.backup_mailbox(&m.id, &dir).await?;
        total.items += stats.items;
        total.bytes += stats.bytes;
    }
    Ok(total)
}

async fn run_onedrive_backup(graph: &GraphClient, backup_dir: &Path) -> Result<BackupStats> {
    let mb = MailboxBackup::new(graph.clone());
    let od = OneDriveBackup::new(graph.clone());
    let mailboxes = mb.list_mailboxes().await?;
    let mut total = BackupStats::default();
    for m in &mailboxes {
        let dir = backup_dir
            .join("onedrive")
            .join(sanitize_filename(&m.id));
        let stats = od.backup_drive(&m.id, &dir).await?;
        total.items += stats.items;
        total.bytes += stats.bytes;
    }
    Ok(total)
}

async fn run_sharepoint_backup(graph: &GraphClient, backup_dir: &Path) -> Result<BackupStats> {
    let sp = SharePointBackup::new(graph.clone());
    let sites = sp.list_sites().await?;
    let mut total = BackupStats::default();
    for s in &sites {
        let dir = backup_dir
            .join("sharepoint")
            .join(sanitize_filename(&s.id));
        let stats = sp.backup_site(&s.id, &dir).await?;
        total.items += stats.items;
        total.bytes += stats.bytes;
    }
    Ok(total)
}
