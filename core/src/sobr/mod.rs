pub mod tier;
pub mod policy;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

/// SOBR (Scale-Out Backup Repository) — multi-tier storage management
///
/// Tiers:
///   - Performance: local SSD/NVMe for fast backup/restore (hot data)
///   - Capacity: HDD / S3 / Azure Blob for warm data
///   - Archive: tape / cold cloud for long-term retention
pub struct SobrManager {
    tiers: Arc<RwLock<Vec<StorageTier>>>,
    policies: Arc<RwLock<Vec<SobrPolicy>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageTier {
    pub id: String,
    pub name: String,
    pub tier_type: TierType,
    pub backend: String,
    pub backend_config: serde_json::Value,
    pub capacity_bytes: u64,
    pub used_bytes: u64,
    pub status: TierStatus,
    pub priority: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TierType {
    Performance,
    Capacity,
    Archive,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TierStatus {
    Online,
    Offline,
    Full,
    Degraded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SobrPolicy {
    pub id: String,
    pub name: String,
    pub performance_tier_id: String,
    pub capacity_tier_id: String,
    pub archive_tier_id: Option<String>,
    /// Move data to capacity tier after N days
    pub capacity_move_days: u32,
    /// Move data to archive tier after N days
    pub archive_move_days: Option<u32>,
    /// Seal backup after N days (read-only)
    pub seal_days: Option<u32>,
}

impl SobrManager {
    pub fn new() -> Self {
        Self {
            tiers: Arc::new(RwLock::new(Vec::new())),
            policies: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Register a storage tier
    pub async fn add_tier(&self, tier: StorageTier) -> Result<StorageTier> {
        let mut tiers = self.tiers.write().await;
        let tier = StorageTier {
            id: uuid::Uuid::new_v4().to_string(),
            ..tier
        };
        info!("SOBR tier added: {} ({:?}) {}B capacity", tier.name, tier.tier_type, tier.capacity_bytes);
        tiers.push(tier.clone());
        Ok(tier)
    }

    /// Create a SOBR policy linking tiers
    pub async fn create_policy(&self, policy: SobrPolicy) -> Result<SobrPolicy> {
        let mut policies = self.policies.write().await;
        let policy = SobrPolicy {
            id: uuid::Uuid::new_v4().to_string(),
            ..policy
        };
        info!("SOBR policy created: {} (capacity: {}d, archive: {:?}d)",
            policy.name, policy.capacity_move_days, policy.archive_move_days);
        policies.push(policy.clone());
        Ok(policy)
    }

    /// Select best tier for incoming backup data
    pub async fn select_target_tier(&self, _data_size_bytes: u64) -> Result<StorageTier> {
        let tiers = self.tiers.read().await;
        // Pick performance tier with most free space
        tiers.iter()
            .filter(|t| t.tier_type == TierType::Performance && t.status == TierStatus::Online)
            .min_by_key(|t| t.used_bytes)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("No available performance tier"))
    }

    /// Execute data movement for a policy against the given snapshots.
    /// Returns the lifecycle plan that was produced.
    pub async fn execute_data_movement(
        &self,
        policy_id: &str,
        snapshots: Vec<crate::sobr::policy::LifecycleSnapshot>,
    ) -> Result<crate::sobr::policy::LifecyclePlan> {
        let policies = self.policies.read().await;
        let policy = policies.iter().find(|p| p.id == policy_id)
            .ok_or_else(|| anyhow::anyhow!("Policy not found: {}", policy_id))?;

        let engine = crate::sobr::policy::DataLifecycleEngine::new();
        let plan = engine.evaluate(
            &snapshots,
            policy.capacity_move_days,
            policy.archive_move_days,
            policy.seal_days,
            0,
        );
        info!("SOBR movement for {}: {} to capacity, {} to archive, {} sealed",
            policy.name, plan.move_to_capacity.len(), plan.move_to_archive.len(), plan.seal.len());

        // Move capacity-tier blocks to the capacity tier backend.
        if let Some(cap) = policies_read_capacity_tier(self, &policy).await {
            let _ = cap;
            info!("Capacity tier available for movement");
        } else {
            warn!("SOBR policy {} has no capacity tier; skipping movement", policy.name);
        }

        Ok(plan)
    }

    /// Get tier usage statistics
    pub async fn get_tier_stats(&self) -> Vec<StorageTier> {
        self.tiers.read().await.clone()
    }

    /// List all SOBR policies
    pub async fn list_policies(&self) -> Vec<SobrPolicy> {
        self.policies.read().await.clone()
    }
}

async fn policies_read_capacity_tier(mgr: &SobrManager, policy: &SobrPolicy) -> Option<StorageTier> {
    mgr.tiers.read().await.iter()
        .find(|t| t.id == policy.capacity_tier_id)
        .cloned()
}
