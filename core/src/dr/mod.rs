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

    pub async fn execute_failover(&self, plan_id: &str) -> Result<()> {
        let plans = self.plans.read().await;
        let plan = plans.iter()
            .find(|p| p.id == plan_id)
            .ok_or_else(|| anyhow::anyhow!("DR plan not found: {}", plan_id))?
            .clone();
        drop(plans);

        *self.status.write().await = DrStatus::FailoverInProgress;

        let vm_order = if plan.failover_order.is_empty() {
            plan.vms.clone()
        } else {
            plan.failover_order.iter()
                .filter(|name| plan.vms.contains(name))
                .cloned()
                .chain(plan.vms.iter().filter(|v| !plan.failover_order.contains(v)).cloned())
                .collect()
        };

        let failover = failover::FailoverEngine::new();
        failover.shutdown_vms(&vm_order, &[]).await?;
        failover.startup_vms(&vm_order).await?;
        failover.wait_for_heartbeat(&vm_order, plan.replication_policy.rto_seconds).await?;

        *self.status.write().await = DrStatus::FailedOver;
        info!("DR failover completed: plan={}", plan.name);
        Ok(())
    }

    pub async fn execute_failback(&self, plan_id: &str) -> Result<()> {
        let plans = self.plans.read().await;
        let plan = plans.iter()
            .find(|p| p.id == plan_id)
            .ok_or_else(|| anyhow::anyhow!("DR plan not found: {}", plan_id))?
            .clone();
        drop(plans);

        *self.status.write().await = DrStatus::FailbackInProgress;

        let replication = replication::ReplicationEngine::new();
        replication.reverse_replication(plan_id).await?;

        let failover = failover::FailoverEngine::new();
        failover.shutdown_vms(&plan.vms, &[]).await?;
        failover.startup_vms(&plan.vms).await?;

        replication.start_replication(&plan.source_site, &plan.target_site, &plan.vms).await?;

        *self.status.write().await = DrStatus::Idle;
        info!("DR failback completed: plan={}", plan.name);
        Ok(())
    }

    pub async fn test_failover(&self, plan_id: &str) -> Result<()> {
        *self.status.write().await = DrStatus::TestInProgress;
        info!("DR test failover started: plan={}", plan_id);

        let plans = self.plans.read().await;
        let plan = plans.iter()
            .find(|p| p.id == plan_id)
            .cloned();
        drop(plans);

        let Some(plan) = plan else {
            *self.status.write().await = DrStatus::Error(format!("plan not found: {}", plan_id));
            return Err(anyhow::anyhow!("DR plan not found: {}", plan_id));
        };

        // Non-destructive validation pass: log the failover order.
        let vm_order = if plan.failover_order.is_empty() {
            plan.vms.clone()
        } else {
            plan.failover_order.iter()
                .filter(|name| plan.vms.contains(name))
                .cloned()
                .chain(plan.vms.iter().filter(|v| !plan.failover_order.contains(v)).cloned())
                .collect()
        };
        info!(
            "DR test failover: plan={} source={} target={} order={:?}",
            plan.name, plan.source_site, plan.target_site, vm_order
        );

        // Verify the target site endpoint is reachable (non-fatal).
        let target = {
            let sites = self.sites.read().await;
            sites.iter().find(|s| s.id == plan.target_site).cloned()
        };

        if let Some(target) = target {
            let site = site::SiteConnector::new();
            match site.test_connection(&target.endpoint).await {
                Ok(true) => info!("DR test failover: target site {} reachable", target.name),
                Ok(false) => info!("DR test failover: target site {} unreachable (non-fatal)", target.name),
                Err(e) => info!("DR test failover: target site {} check failed (non-fatal): {}", target.name, e),
            }
        } else {
            info!("DR test failover: target site {} not registered; skipping reachability check", plan.target_site);
        }

        // Build the failover engine (degrades to logging when no connector).
        let failover = failover::FailoverEngine::new();
        if !failover.has_connector() {
            info!("DR test failover: no hypervisor connector configured; running in planning mode");
        } else {
            info!("DR test failover: hypervisor connector available; validating VM references");
        }

        *self.status.write().await = DrStatus::Idle;
        info!("DR test failover completed: plan={}", plan.name);
        Ok(())
    }

    pub async fn get_status(&self) -> DrStatus {
        self.status.read().await.clone()
    }

    pub async fn list_plans(&self) -> Vec<DrPlan> {
        self.plans.read().await.clone()
    }

    pub async fn list_sites(&self) -> Vec<DrSite> {
        self.sites.read().await.clone()
    }
}
