pub mod site;
pub mod failover;
pub mod replication;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrPlan {
    pub id: String,
    pub name: String,
    pub source_site: String,
    pub target_site: String,
    pub vms: Vec<String>,
    pub replication_policy: ReplicationPolicy,
    pub failover_order: Vec<String>,
    pub auto_commit: bool,
    pub test_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicationPolicy {
    pub rpo_seconds: u64,
    pub rto_seconds: u64,
    pub compression: String,
    pub encryption: bool,
    pub bandwidth_throttle_mbps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DrStatus {
    Idle,
    Replicating,
    FailoverInProgress,
    FailedOver,
    FailbackInProgress,
    TestInProgress,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrSite {
    pub id: String,
    pub name: String,
    pub dr_type: SiteType,
    pub endpoint: String,
    pub credentials_id: String,
    pub storage_id: String,
    pub is_primary: bool,
    pub status: SiteStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SiteType {
    Vmware,
    HyperV,
    CloudAws,
    CloudAzure,
    RemoteBck,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SiteStatus {
    Online,
    Offline,
    Degraded,
    Unknown,
}

/// Disaster Recovery orchestrator
pub struct DrOrchestrator {
    plans: Arc<RwLock<Vec<DrPlan>>>,
    sites: Arc<RwLock<Vec<DrSite>>>,
    status: Arc<RwLock<DrStatus>>,
}

impl DrOrchestrator {
    pub fn new() -> Self {
        Self {
            plans: Arc::new(RwLock::new(Vec::new())),
            sites: Arc::new(RwLock::new(Vec::new())),
            status: Arc::new(RwLock::new(DrStatus::Idle)),
        }
    }

    /// Register a DR site
    pub async fn register_site(&self, site: DrSite) -> Result<DrSite> {
        let mut sites = self.sites.write().await;
        let site = DrSite {
            id: uuid::Uuid::new_v4().to_string(),
            ..site
        };
        info!("DR site registered: {} ({})", site.name, site.endpoint);
        sites.push(site.clone());
        Ok(site)
    }

    /// Create a DR plan
    pub async fn create_plan(&self, plan: DrPlan) -> Result<DrPlan> {
        let mut plans = self.plans.write().await;
        let plan = DrPlan {
            id: uuid::Uuid::new_v4().to_string(),
            ..plan
        };
        info!("DR plan created: {} (RTO={}s, RPO={}s)",
            plan.name, plan.replication_policy.rto_seconds, plan.replication_policy.rpo_seconds);
        plans.push(plan.clone());
        Ok(plan)
    }

    /// Execute failover for a DR plan
    pub async fn execute_failover(&self, plan_id: &str) -> Result<()> {
        let plans = self.plans.read().await;
        let plan = plans.iter()
            .find(|p| p.id == plan_id)
            .ok_or_else(|| anyhow::anyhow!("DR plan not found: {}", plan_id))?
            .clone();
        drop(plans);

        *self.status.write().await = DrStatus::FailoverInProgress;
        info!("DR failover started: plan={}", plan.name);

        // 1. Stop replication from source
        // 2. Power down source VMs (if possible)
        // 3. Apply latest replicated data
        // 4. Power on VMs on target site
        // 5. Update DNS / networking
        // 6. Verify application health

        *self.status.write().await = DrStatus::FailedOver;
        info!("DR failover completed: plan={}", plan.name);
        Ok(())
    }

    /// Execute failback — return workloads to primary site
    pub async fn execute_failback(&self, plan_id: &str) -> Result<()> {
        let plans = self.plans.read().await;
        let plan = plans.iter()
            .find(|p| p.id == plan_id)
            .ok_or_else(|| anyhow::anyhow!("DR plan not found: {}", plan_id))?
            .clone();
        drop(plans);

        *self.status.write().await = DrStatus::FailbackInProgress;
        info!("DR failback started: plan={}", plan.name);

        // 1. Reverse replication direction
        // 2. Sync changes back to primary
        // 3. Power down VMs on DR site
        // 4. Power on VMs on primary
        // 5. Resume normal replication

        *self.status.write().await = DrStatus::Idle;
        info!("DR failback completed: plan={}", plan.name);
        Ok(())
    }

    /// Test failover (isolated, no production impact)
    pub async fn test_failover(&self, plan_id: &str) -> Result<()> {
        *self.status.write().await = DrStatus::TestInProgress;
        info!("DR test failover started: plan={}", plan_id);

        // Create isolated test VMs from replicated data
        // Run verification tests
        // Auto-cleanup

        *self.status.write().await = DrStatus::Idle;
        info!("DR test failover completed: plan={}", plan_id);
        Ok(())
    }

    /// Get current DR status
    pub async fn get_status(&self) -> DrStatus {
        self.status.read().await.clone()
    }

    /// List all DR plans
    pub async fn list_plans(&self) -> Vec<DrPlan> {
        self.plans.read().await.clone()
    }

    /// List registered sites
    pub async fn list_sites(&self) -> Vec<DrSite> {
        self.sites.read().await.clone()
    }
}
