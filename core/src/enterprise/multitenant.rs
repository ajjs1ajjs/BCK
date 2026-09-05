use crate::db::DbPool;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

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

/// Tenant manager — multi-tenancy isolation and resource quotas.
///
/// SEC-016: tenants are persisted in the `tenants` table. The in-memory cache
/// is hydrated on first read and synchronized on every mutation. A daemon
/// restart no longer wipes quotas, settings, or status.
pub struct TenantManager {
    db: DbPool,
    tenants: Arc<RwLock<Vec<Tenant>>>,
    hydrated: Arc<RwLock<bool>>,
}

impl TenantManager {
    pub fn new(db: DbPool) -> Self {
        Self {
            db,
            tenants: Arc::new(RwLock::new(Vec::new())),
            hydrated: Arc::new(RwLock::new(false)),
        }
    }

    /// Ensure the in-memory cache reflects the database. Called automatically
    /// on the first read or write; can also be called explicitly at startup.
    pub async fn hydrate(&self) -> Result<()> {
        {
            let h = self.hydrated.read().await;
            if *h {
                return Ok(());
            }
        }
        let loaded = load_from_db(&self.db).await.unwrap_or_else(|e| {
            warn!("tenant hydrate from DB failed ({}); starting empty", e);
            Vec::new()
        });
        let mut cache = self.tenants.write().await;
        *cache = loaded;
        let mut h = self.hydrated.write().await;
        *h = true;
        Ok(())
    }

    /// Create a new tenant (persisted).
    pub async fn create_tenant(&self, name: &str, slug: &str) -> Result<Tenant> {
        self.hydrate().await?;
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
        upsert_to_db(&self.db, &tenant).await?;
        self.tenants.write().await.push(tenant.clone());
        info!("Tenant created: {} ({})", name, slug);
        Ok(tenant)
    }

    /// Check if operation is within tenant's quota
    pub async fn check_quota(&self, tenant_id: &str, resource: &str) -> Result<bool> {
        self.hydrate().await?;
        let tenants = self.tenants.read().await;
        let tenant = tenants
            .iter()
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

    /// Update resource usage for a tenant (persisted).
    pub async fn update_usage(&self, tenant_id: &str, delta: ResourceUsage) -> Result<bool> {
        self.hydrate().await?;
        let mut tenants = self.tenants.write().await;
        match tenants.iter_mut().find(|t| t.id == tenant_id) {
            Some(tenant) => {
                tenant.usage.repositories += delta.repositories;
                tenant.usage.vms += delta.vms;
                tenant.usage.users += delta.users;
                tenant.usage.storage_used_gb += delta.storage_used_gb;
                tenant.usage.snapshots_total += delta.snapshots_total;
                tenant.usage.monthly_data_written_gb += delta.monthly_data_written_gb;
                let updated = tenant.clone();
                drop(tenants);
                upsert_to_db(&self.db, &updated).await?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Suspend a tenant (persisted).
    pub async fn suspend_tenant(&self, tenant_id: &str) -> Result<()> {
        self.hydrate().await?;
        let mut tenants = self.tenants.write().await;
        if let Some(tenant) = tenants.iter_mut().find(|t| t.id == tenant_id) {
            tenant.status = TenantStatus::Suspended;
            let updated = tenant.clone();
            drop(tenants);
            upsert_to_db(&self.db, &updated).await?;
            info!("Tenant suspended: {}", tenant_id);
        }
        Ok(())
    }

    /// Set a tenant's status (persisted).
    pub async fn set_status(&self, tenant_id: &str, status: TenantStatus) -> Result<bool> {
        self.hydrate().await?;
        let mut tenants = self.tenants.write().await;
        match tenants.iter_mut().find(|t| t.id == tenant_id) {
            Some(tenant) => {
                tenant.status = status;
                let updated = tenant.clone();
                drop(tenants);
                upsert_to_db(&self.db, &updated).await?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Delete a tenant. SEC-016: also null out the `users.tenant_id` so the
    /// delete does not leave orphan users with a dangling FK reference.
    pub async fn delete_tenant(&self, tenant_id: &str) -> Result<bool> {
        self.hydrate().await?;
        let mut tenants = self.tenants.write().await;
        let len_before = tenants.len();
        tenants.retain(|t| t.id != tenant_id);
        let removed = tenants.len() < len_before;
        drop(tenants);
        if removed {
            delete_from_db(&self.db, tenant_id).await?;
            // Null-out the tenant reference on users so the DB stays
            // consistent. A separate admin step can re-assign or delete them.
            null_user_tenant(&self.db, tenant_id).await.ok();
            info!("Tenant deleted: {}", tenant_id);
        }
        Ok(removed)
    }

    /// Update a tenant's resource quota (persisted).
    pub async fn update_quota(&self, tenant_id: &str, quota: Quota) -> Result<bool> {
        self.hydrate().await?;
        let mut tenants = self.tenants.write().await;
        match tenants.iter_mut().find(|t| t.id == tenant_id) {
            Some(tenant) => {
                tenant.quota = quota;
                let updated = tenant.clone();
                drop(tenants);
                upsert_to_db(&self.db, &updated).await?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Update a tenant's settings (persisted).
    pub async fn update_settings(
        &self,
        tenant_id: &str,
        settings: TenantSettings,
    ) -> Result<bool> {
        self.hydrate().await?;
        let mut tenants = self.tenants.write().await;
        match tenants.iter_mut().find(|t| t.id == tenant_id) {
            Some(tenant) => {
                tenant.settings = settings;
                let updated = tenant.clone();
                drop(tenants);
                upsert_to_db(&self.db, &updated).await?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Get a tenant's current resource usage
    pub async fn get_usage(&self, tenant_id: &str) -> Option<ResourceUsage> {
        self.hydrate().await.ok()?;
        self.tenants
            .read()
            .await
            .iter()
            .find(|t| t.id == tenant_id)
            .map(|t| t.usage.clone())
    }

    /// List all tenants
    pub async fn list_tenants(&self) -> Vec<Tenant> {
        self.hydrate().await.ok();
        self.tenants.read().await.clone()
    }

    /// Get tenant by ID
    pub async fn get_tenant(&self, tenant_id: &str) -> Option<Tenant> {
        self.hydrate().await.ok()?;
        self.tenants
            .read()
            .await
            .iter()
            .find(|t| t.id == tenant_id)
            .cloned()
    }
}

async fn load_from_db(db: &DbPool) -> Result<Vec<Tenant>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query(
                "SELECT id, name, slug, status, quota_json, usage_json, settings_json, created_at
                 FROM tenants",
            )
            .fetch_all(pool)
            .await?;
            Ok(rows
                .into_iter()
                .map(|r| {
                    use sqlx::Row;
                    let quota: Quota = serde_json::from_str(
                        r.get::<String, _>("quota_json").as_str(),
                    )
                    .unwrap_or_default_quota();
                    let usage: ResourceUsage = serde_json::from_str(
                        r.get::<String, _>("usage_json").as_str(),
                    )
                    .unwrap_or_default();
                    let settings: TenantSettings = serde_json::from_str(
                        r.get::<String, _>("settings_json").as_str(),
                    )
                    .unwrap_or_default_settings();
                    let status_str: String = r.get("status");
                    let status = match status_str.as_str() {
                        "Suspended" => TenantStatus::Suspended,
                        "Disabled" => TenantStatus::Disabled,
                        _ => TenantStatus::Active,
                    };
                    Tenant {
                        id: r.get("id"),
                        name: r.get("name"),
                        slug: r.get("slug"),
                        status,
                        quota,
                        usage,
                        settings,
                        created_at: r.get("created_at"),
                    }
                })
                .collect())
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT id, name, slug, status, quota_json, usage_json, settings_json, created_at
                 FROM tenants",
            )
            .fetch_all(pool)
            .await?;
            Ok(rows
                .into_iter()
                .map(|r| {
                    use sqlx::Row;
                    let quota: Quota = serde_json::from_str(
                        r.get::<String, _>("quota_json").as_str(),
                    )
                    .unwrap_or_default_quota();
                    let usage: ResourceUsage = serde_json::from_str(
                        r.get::<String, _>("usage_json").as_str(),
                    )
                    .unwrap_or_default();
                    let settings: TenantSettings = serde_json::from_str(
                        r.get::<String, _>("settings_json").as_str(),
                    )
                    .unwrap_or_default_settings();
                    let status_str: String = r.get("status");
                    let status = match status_str.as_str() {
                        "Suspended" => TenantStatus::Suspended,
                        "Disabled" => TenantStatus::Disabled,
                        _ => TenantStatus::Active,
                    };
                    Tenant {
                        id: r.get("id"),
                        name: r.get("name"),
                        slug: r.get("slug"),
                        status,
                        quota,
                        usage,
                        settings,
                        created_at: r.get("created_at"),
                    }
                })
                .collect())
        }
    }
}

async fn upsert_to_db(db: &DbPool, t: &Tenant) -> Result<()> {
    let quota_json = serde_json::to_string(&t.quota)?;
    let usage_json = serde_json::to_string(&t.usage)?;
    let settings_json = serde_json::to_string(&t.settings)?;
    let status = match t.status {
        TenantStatus::Active => "Active",
        TenantStatus::Suspended => "Suspended",
        TenantStatus::Disabled => "Disabled",
    };
    match db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO tenants (id, name, slug, status, quota_json, usage_json, settings_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    slug = excluded.slug,
                    status = excluded.status,
                    quota_json = excluded.quota_json,
                    usage_json = excluded.usage_json,
                    settings_json = excluded.settings_json",
            )
            .bind(&t.id)
            .bind(&t.name)
            .bind(&t.slug)
            .bind(status)
            .bind(&quota_json)
            .bind(&usage_json)
            .bind(&settings_json)
            .bind(t.created_at)
            .execute(pool)
            .await?;
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO tenants (id, name, slug, status, quota_json, usage_json, settings_json, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT(id) DO UPDATE SET
                    name = EXCLUDED.name,
                    slug = EXCLUDED.slug,
                    status = EXCLUDED.status,
                    quota_json = EXCLUDED.quota_json,
                    usage_json = EXCLUDED.usage_json,
                    settings_json = EXCLUDED.settings_json",
            )
            .bind(&t.id)
            .bind(&t.name)
            .bind(&t.slug)
            .bind(status)
            .bind(&quota_json)
            .bind(&usage_json)
            .bind(&settings_json)
            .bind(t.created_at)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

async fn delete_from_db(db: &DbPool, tenant_id: &str) -> Result<()> {
    match db {
        DbPool::Sqlite(pool) => {
            sqlx::query("DELETE FROM tenants WHERE id = ?1")
                .bind(tenant_id)
                .execute(pool)
                .await?;
        }
        DbPool::Postgres(pool) => {
            sqlx::query("DELETE FROM tenants WHERE id = $1")
                .bind(tenant_id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

async fn null_user_tenant(db: &DbPool, tenant_id: &str) -> Result<()> {
    match db {
        DbPool::Sqlite(pool) => {
            sqlx::query("UPDATE users SET tenant_id = NULL WHERE tenant_id = ?1")
                .bind(tenant_id)
                .execute(pool)
                .await?;
        }
        DbPool::Postgres(pool) => {
            sqlx::query("UPDATE users SET tenant_id = NULL WHERE tenant_id = $1")
                .bind(tenant_id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

trait QuotaDefault {
    fn unwrap_or_default_quota(self) -> Quota;
}
impl QuotaDefault for Result<Quota, serde_json::Error> {
    fn unwrap_or_default_quota(self) -> Quota {
        self.unwrap_or(Quota {
            max_repositories: 5,
            max_vms: 50,
            max_users: 10,
            max_storage_gb: 1024,
            max_retention_days: 90,
            max_snapshots_per_vm: 30,
            allow_cloud_tiers: false,
            allow_tape: false,
        })
    }
}

trait SettingsDefault {
    fn unwrap_or_default_settings(self) -> TenantSettings;
}
impl SettingsDefault for Result<TenantSettings, serde_json::Error> {
    fn unwrap_or_default_settings(self) -> TenantSettings {
        self.unwrap_or(TenantSettings {
            default_retention_days: 30,
            backup_window_start: "22:00".into(),
            backup_window_end: "06:00".into(),
            notify_on_failure: true,
            notify_on_success: false,
            allowed_hypervisors: vec!["vmware".into(), "hyperv".into()],
            allowed_storage: vec!["local".into(), "s3".into()],
        })
    }
}
