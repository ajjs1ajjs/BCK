use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

/// A snapshot eligible for lifecycle evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleSnapshot {
    pub id: String,
    pub created_at: i64,
    pub size_bytes: u64,
    pub parent_id: Option<String>,
}

/// Result of a lifecycle evaluation pass.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LifecyclePlan {
    /// Snapshot ids to move to the capacity tier.
    pub move_to_capacity: Vec<String>,
    /// Snapshot ids to move to the archive tier.
    pub move_to_archive: Vec<String>,
    /// Snapshot ids to delete (expired + no longer referenced).
    pub delete: Vec<String>,
    /// Snapshot ids to seal (make read-only).
    pub seal: Vec<String>,
}

impl LifecyclePlan {
    pub fn is_empty(&self) -> bool {
        self.move_to_capacity.is_empty()
            && self.move_to_archive.is_empty()
            && self.delete.is_empty()
            && self.seal.is_empty()
    }
}

/// Data lifecycle policy engine: decides tier movement, archival, sealing and
/// deletion based on snapshot age and SOBR policy thresholds.
pub struct DataLifecycleEngine {
    now: i64,
}

impl DataLifecycleEngine {
    pub fn new() -> Self {
        Self {
            now: chrono::Utc::now().timestamp(),
        }
    }

    /// Build a lifecycle plan for the given snapshots against the policy
    /// thresholds (in days). Days = 0 disables that stage.
    pub fn evaluate(
        &self,
        snapshots: &[LifecycleSnapshot],
        capacity_move_days: u32,
        archive_move_days: Option<u32>,
        seal_days: Option<u32>,
        retention_days: u32,
    ) -> LifecyclePlan {
        let mut plan = LifecyclePlan::default();
        let day_secs = 86_400i64;

        for snap in snapshots {
            let age_days = ((self.now - snap.created_at).max(0) as u64) / day_secs as u64;
            let expired = retention_days > 0 && age_days >= retention_days as u64;
            let move_cap = capacity_move_days > 0 && age_days >= capacity_move_days as u64;
            let move_arch = archive_move_days.is_some() && age_days >= archive_move_days.unwrap() as u64;
            let seal = seal_days.is_some() && age_days >= seal_days.unwrap() as u64;

            if expired {
                plan.delete.push(snap.id.clone());
                continue;
            }
            if move_arch {
                plan.move_to_archive.push(snap.id.clone());
            } else if move_cap {
                plan.move_to_capacity.push(snap.id.clone());
            }
            if seal {
                plan.seal.push(snap.id.clone());
            }
        }

        info!(
            "Lifecycle: {} to capacity, {} to archive, {} to seal, {} to delete",
            plan.move_to_capacity.len(),
            plan.move_to_archive.len(),
            plan.seal.len(),
            plan.delete.len()
        );
        plan
    }

    /// Evaluate which backups need tier movement (compatibility wrapper).
    pub async fn evaluate_movement(&self, policy: &super::SobrPolicy, snapshots: &[LifecycleSnapshot]) -> Result<Vec<String>> {
        let plan = self.evaluate(
            snapshots,
            policy.capacity_move_days,
            policy.archive_move_days,
            policy.seal_days,
            0,
        );
        Ok(plan.move_to_capacity.into_iter().chain(plan.move_to_archive).collect())
    }

    /// Evaluate which backups need archival.
    pub async fn evaluate_archival(&self, policy: &super::SobrPolicy, snapshots: &[LifecycleSnapshot]) -> Result<Vec<String>> {
        let plan = self.evaluate(
            snapshots,
            policy.capacity_move_days,
            policy.archive_move_days,
            policy.seal_days,
            0,
        );
        Ok(plan.move_to_archive)
    }

    /// Evaluate which backups need deletion (expired by retention).
    pub async fn evaluate_cleanup(&self, policy: &super::SobrPolicy, snapshots: &[LifecycleSnapshot], retention_days: u32) -> Result<Vec<String>> {
        let plan = self.evaluate(
            snapshots,
            policy.capacity_move_days,
            policy.archive_move_days,
            policy.seal_days,
            retention_days,
        );
        Ok(plan.delete)
    }

    /// Apply retention policy — returns number of expired snapshots.
    pub async fn apply_retention(&self, policy: &super::SobrPolicy, snapshots: &[LifecycleSnapshot], retention_days: u32) -> Result<u64> {
        let plan = self.evaluate(
            snapshots,
            policy.capacity_move_days,
            policy.archive_move_days,
            policy.seal_days,
            retention_days,
        );
        Ok(plan.delete.len() as u64)
    }

    /// A dry-run estimate is exposed for reporting.
    pub fn estimate_bytes_reclaimable(&self, snapshots: &[LifecycleSnapshot], retention_days: u32) -> u64 {
        let day_secs = 86_400i64;
        snapshots
            .iter()
            .filter(|s| {
                let age = ((self.now - s.created_at).max(0) as u64) / day_secs as u64;
                retention_days > 0 && age >= retention_days as u64
            })
            .map(|s| s.size_bytes)
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(id: &str, age_days: i64, size: u64) -> LifecycleSnapshot {
        LifecycleSnapshot {
            id: id.to_string(),
            created_at: chrono::Utc::now().timestamp() - age_days * 86_400,
            size_bytes: size,
            parent_id: None,
        }
    }

    #[test]
    fn moves_and_deletes() {
        let engine = DataLifecycleEngine::new();
        let snaps = vec![
            snap("fresh", 1, 100),
            snap("week", 8, 200),
            snap("month", 35, 300),
            snap("old", 400, 400),
        ];
        let plan = engine.evaluate(&snaps, 7, Some(30), Some(60), 365);
        assert_eq!(plan.move_to_capacity, vec!["week"]);
        assert_eq!(plan.move_to_archive, vec!["month"]);
        assert_eq!(plan.seal, vec!["month"]);
        assert_eq!(plan.delete, vec!["old"]);
    }

    #[test]
    fn empty_when_nothing_old() {
        let engine = DataLifecycleEngine::new();
        let snaps = vec![snap("fresh", 0, 10)];
        let plan = engine.evaluate(&snaps, 7, Some(30), Some(60), 365);
        assert!(plan.is_empty());
    }

    #[test]
    fn reclaimable_bytes() {
        let engine = DataLifecycleEngine::new();
        let snaps = vec![snap("a", 500, 1000), snap("b", 1, 50)];
        assert_eq!(engine.estimate_bytes_reclaimable(&snaps, 365), 1000);
    }
}
