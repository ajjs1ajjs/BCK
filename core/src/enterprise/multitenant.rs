use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub status: TenantStatus,
    pub quota: Quota,
    pub usage: ResourceUsage,
    pub settings: TenantSettings,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TenantStatus {
    Active,
    Suspended,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quota {
    pub max_repositories: u32,
    pub max_vms: u32,
    pub max_users: u32,
    pub max_storage_gb: u64,
    pub max_retention_days: u32,
    pub max_snapshots_per_vm: u32,
    pub allow_cloud_tiers: bool,
    pub allow_tape: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResourceUsage {
    pub repositories: u32,
    pub vms: u32,
    pub users: u32,
    pub storage_used_gb: u64,
    pub snapshots_total: u32,
    pub monthly_data_written_gb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantSettings {
    pub default_retention_days: u32,
    pub backup_window_start: String,
    pub backup_window_end: String,
    pub notify_on_failure: bool,
    pub notify_on_success: bool,
    pub allowed_hypervisors: Vec<String>,
    pub allowed_storage: Vec<String>,
}

/// Tenant manager — multi-tenancy isolation and resource quotas
pub struct TenantManager {
    tenants: Arc<RwLock<Vec<Tenant>>>,
}

impl TenantManager {
    pub fn new() -> Self {
        Self {
            tenants: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Create a new tenant
    pub async fn create_tenant(&self, name: &str, slug: &str) -> Result<Tenant> {
        let tenant = Tenant {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            slug: slug.to_string(),
            status: TenantStatus::Active,
            quota: Quota {
                max_repositories: 5,
                max_vms: 50,
                max_users: 10,
                max_storage_gb: 1024,
                max_retention_days: 90,
                max_snapshots_per_vm: 30,
                allow_cloud_tiers: false,
                allow_tape: false,
            },
            usage: ResourceUsage::default(),
            settings: TenantSettings {
                default_retention_days: 30,
                backup_window_start: "22:00".into(),
                backup_window_end: "06:00".into(),
                notify_on_failure: true,
                notify_on_success: false,
                allowed_hypervisors: vec!["vmware".into(), "hyperv".into()],
                allowed_storage: vec!["local".into(), "s3".into()],
            },
            created_at: chrono::Utc::now().timestamp(),
        };

        self.tenants.write().await.push(tenant.clone());
        info!("Tenant created: {} ({})", name, slug);
        Ok(tenant)
    }

    /// Check if operation is within tenant's quota
    pub async fn check_quota(&self, tenant_id: &str, resource: &str) -> Result<bool> {
        let tenants = self.tenants.read().await;
        let tenant = tenants.iter()
            .find(|t| t.id == tenant_id)
            .ok_or_else(|| anyhow::anyhow!("Tenant not found: {}", tenant_id))?;

        let within = match resource {
            "repository" => tenant.usage.repositories < tenant.quota.max_repositories,
            "vm" => tenant.usage.vms < tenant.quota.max_vms,
            "user" => tenant.usage.users < tenant.quota.max_users,
            "storage" => tenant.usage.storage_used_gb < tenant.quota.max_storage_gb,
            _ => true,
        };

        Ok(within)
    }

    /// Update resource usage for a tenant
    pub async fn update_usage(&self, tenant_id: &str, delta: ResourceUsage) -> Result<()> {
        let mut tenants = self.tenants.write().await;
        if let Some(tenant) = tenants.iter_mut().find(|t| t.id == tenant_id) {
            tenant.usage.repositories += delta.repositories;
            tenant.usage.vms += delta.vms;
            tenant.usage.users += delta.users;
            tenant.usage.storage_used_gb += delta.storage_used_gb;
            tenant.usage.snapshots_total += delta.snapshots_total;
            tenant.usage.monthly_data_written_gb += delta.monthly_data_written_gb;
        }
        Ok(())
    }

    /// Suspend a tenant
    pub async fn suspend_tenant(&self, tenant_id: &str) -> Result<()> {
        let mut tenants = self.tenants.write().await;
        if let Some(tenant) = tenants.iter_mut().find(|t| t.id == tenant_id) {
            tenant.status = TenantStatus::Suspended;
            info!("Tenant suspended: {}", tenant.name);
        }
        Ok(())
    }

    /// List all tenants
    pub async fn list_tenants(&self) -> Vec<Tenant> {
        self.tenants.read().await.clone()
    }

    /// Get tenant by ID
    pub async fn get_tenant(&self, tenant_id: &str) -> Option<Tenant> {
        self.tenants.read().await.iter()
            .find(|t| t.id == tenant_id)
            .cloned()
    }
}
