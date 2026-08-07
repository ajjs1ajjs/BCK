pub mod tier;
pub mod policy;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::sobr::policy::DataLifecycleEngine;
use crate::sobr::tier::TierBackend;

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
    /// Delete backups older than N days (retention)
    pub retention_days: Option<u32>,
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

    /// Execute data movement according to a policy. Registers the policy's
    /// tier backends on the lifecycle engine, then performs age-based movement,
    /// archival, sealing, and retention. Returns total bytes moved.
    pub async fn execute_data_movement(
        &self,
        policy_id: &str,
        engine: &DataLifecycleEngine,
    ) -> Result<u64> {
        let policy = self.get_policy(policy_id).await?;

        let perf = self.resolve_tier(&policy.performance_tier_id).await?;
        let cap = self.resolve_tier(&policy.capacity_tier_id).await?;
        engine.register_tier_backend(TierBackend::from_tier(&perf).await?).await?;
        engine.register_tier_backend(TierBackend::from_tier(&cap).await?).await?;

        if let Some(archive_id) = &policy.archive_tier_id {
            let archive = self.resolve_tier(archive_id).await?;
            engine.register_tier_backend(TierBackend::from_tier(&archive).await?).await?;
        }

        info!("SOBR executing policy {}: {} tiers", policy.name, if policy.archive_tier_id.is_some() { 3 } else { 2 });
        let moved = engine.execute_policy(&policy).await?;
        Ok(moved)
    }

    async fn get_policy(&self, policy_id: &str) -> Result<SobrPolicy> {
        let policies = self.policies.read().await;
        policies
            .iter()
            .find(|p| p.id == policy_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("SOBR policy not found: {}", policy_id))
    }

    async fn resolve_tier(&self, tier_id: &str) -> Result<StorageTier> {
        let tiers = self.tiers.read().await;
        tiers
            .iter()
            .find(|t| t.id == tier_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("SOBR tier not found: {}", tier_id))
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
