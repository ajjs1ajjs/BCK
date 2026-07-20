pub mod sso;
pub mod reports;
pub mod multitenant;
pub mod audit;

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::server::AppState;

/// Enterprise feature manager — coordinates SSO, reporting, multi-tenancy, audit
pub struct EnterpriseManager {
    sso: sso::SsoManager,
    reports: reports::ReportEngine,
    tenant: multitenant::TenantManager,
    audit: audit::AuditLogger,
    state: Arc<AppState>,
}

impl EnterpriseManager {
    pub fn new(state: Arc<AppState>) -> Result<Self> {
        Ok(Self {
            sso: sso::SsoManager::new(),
            reports: reports::ReportEngine::new(),
            tenant: multitenant::TenantManager::new(),
            audit: audit::AuditLogger::new(),
            state,
        })
    }

    pub async fn initialize(&self) -> Result<()> {
        info!("Enterprise features initializing");
        // Load SSO providers
        // Initialize audit log DB table
        // Load tenant configurations
        Ok(())
    }

    pub fn sso(&self) -> &sso::SsoManager { &self.sso }
    pub fn reports(&self) -> &reports::ReportEngine { &self.reports }
    pub fn tenant(&self) -> &multitenant::TenantManager { &self.tenant }
    pub fn audit(&self) -> &audit::AuditLogger { &self.audit }
}
