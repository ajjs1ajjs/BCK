use anyhow::{Result, anyhow};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::index::BlockIndex;

use super::SobrPolicy;
use super::tier::TierBackend;

/// Tracks where each backup currently lives. Backups without an entry are
/// assumed to sit on the policy's performance (initial write) tier.
type PlacementMap = HashMap<String, String>;

/// Data lifecycle policy engine.
///
/// Backups are snapshots recorded in the `BlockIndex` (age, manifest → block
/// references). This engine evaluates age-based tier movement / archival /
/// retention against real storage backends registered per tier, and performs
/// actual block-level data movement and deletion.
pub struct DataLifecycleEngine {
    index: Arc<BlockIndex>,
    tiers: Arc<RwLock<HashMap<String, Arc<TierBackend>>>>,
    placements: Arc<RwLock<PlacementMap>>,
}

impl DataLifecycleEngine {
    pub fn new(index: Arc<BlockIndex>) -> Self {
        Self {
            index,
            tiers: Arc::new(RwLock::new(HashMap::new())),
            placements: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register_tier_backend(&self, backend: TierBackend) -> Result<()> {
        let id = backend.tier_id().to_string();
        self.tiers.write().await.insert(id, Arc::new(backend));
        Ok(())
    }

    pub async fn tier_backend(&self, tier_id: &str) -> Result<Arc<TierBackend>> {
        self.tiers
            .read()
            .await
            .get(tier_id)
            .cloned()
            .ok_or_else(|| anyhow!("Tier backend not registered: {}", tier_id))
    }

    pub async fn set_placement(&self, backup_id: &str, tier_id: &str) {
        self.placements
            .write()
            .await
            .insert(backup_id.to_string(), tier_id.to_string());
    }

    pub async fn remove_placement(&self, backup_id: &str) {
        self.placements.write().await.remove(backup_id);
    }

    pub async fn placement(&self, backup_id: &str) -> Option<String> {
        self.placements.read().await.get(backup_id).cloned()
    }

    /// All known placements as (backup_id, tier_id).
    pub async fn placements(&self) -> Vec<(String, String)> {
        self.placements
            .read()
            .await
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// Backups that should move from the performance tier to the capacity tier.
    pub async fn evaluate_movement(&self, policy: &SobrPolicy) -> Result<Vec<String>> {
        let perf = policy.performance_tier_id.clone();
        let mut out = Vec::new();
        for (id, tier) in self.age_evaluate(policy.capacity_move_days as u64).await? {
            if tier.as_deref().unwrap_or(&perf) != &perf {
                continue;
            }
            if self.is_sealed(&id, &perf).await.unwrap_or(false) {
                continue;
            }
            out.push(id);
        }
        Ok(out)
    }

    /// Backups that should move from the capacity tier to the archive tier.
    pub async fn evaluate_archival(&self, policy: &SobrPolicy) -> Result<Vec<String>> {
        let Some(days) = policy.archive_move_days else {
            return Ok(Vec::new());
        };
        let perf = policy.performance_tier_id.clone();
        let cap = policy.capacity_tier_id.clone();
        let mut out = Vec::new();
        for (id, tier) in self.age_evaluate(days as u64).await? {
            if tier.as_deref().unwrap_or(&perf) != &cap {
                continue;
            }
            if self.is_sealed(&id, &perf).await.unwrap_or(false) {
                continue;
            }
            out.push(id);
        }
        Ok(out)
    }

    /// Backups past their retention window that are eligible for deletion.
    pub async fn evaluate_cleanup(&self, policy: &SobrPolicy) -> Result<Vec<String>> {
        let Some(days) = policy.retention_days else {
            return Ok(Vec::new());
        };
        let perf = policy.performance_tier_id.clone();
        let mut out = Vec::new();
        for (id, _) in self.age_evaluate(days as u64).await? {
            if self.is_sealed(&id, &perf).await.unwrap_or(false) {
                continue;
            }
            out.push(id);
        }
        Ok(out)
    }

    /// Seal backups that reached `seal_days`; returns how many were sealed.
    pub async fn seal_expired(&self, policy: &SobrPolicy) -> Result<u64> {
        let Some(days) = policy.seal_days else {
            return Ok(0);
        };
        let mut sealed = 0u64;
        for (id, tier) in self.age_evaluate(days as u64).await? {
            if self.is_sealed(&id, &policy.performance_tier_id).await.unwrap_or(false) {
                continue;
            }
            let tier_id = tier.unwrap_or_else(|| policy.performance_tier_id.clone());
            let backend = self.tier_backend(&tier_id).await?;
            backend.seal_backup(&id).await?;
            sealed += 1;
        }
        Ok(sealed)
    }

    /// Move one backup's blocks from its current tier to `target_tier_id`.
    /// Shared blocks (positive refcount after decrement) stay on the source.
    /// Returns the number of bytes moved.
    pub async fn move_backup(
        &self,
        backup_id: &str,
        source_tier_id: &str,
        target_tier_id: &str,
    ) -> Result<u64> {
        let source = self.tier_backend(source_tier_id).await?;
        let target = self.tier_backend(target_tier_id).await?;

        let manifest = self
            .index
            .load_manifest(backup_id)?
            .ok_or_else(|| anyhow!("Backup {} has no manifest", backup_id))?;

        let mut shas = Vec::new();
        for block in &manifest.blocks {
            if !shas.contains(&block.block_id.sha256) {
                shas.push(block.block_id.sha256.clone());
            }
        }

        let copied = source.copy_blocks_to(&target, &shas).await?;
        for sha in &shas {
            if self.index.remove_block(sha)? {
                source.delete_blocks(&[sha.clone()]).await?;
            }
        }

        self.set_placement(backup_id, target_tier_id).await;
        Ok(copied)
    }

    /// Apply retention: physically delete expired backups' blocks (respecting
    /// refcounts) and remove their metadata. Returns the number deleted.
    pub async fn apply_retention(&self, policy: &SobrPolicy) -> Result<u64> {
        let candidates = self.evaluate_cleanup(policy).await?;
        let mut deleted = 0u64;
        for id in candidates {
            let tier = self
                .placement(&id)
                .await
                .unwrap_or_else(|| policy.performance_tier_id.clone());
            let source = self.tier_backend(&tier).await?;

            if let Some(manifest) = self.index.load_manifest(&id)? {
                let mut shas = Vec::new();
                for block in &manifest.blocks {
                    if !shas.contains(&block.block_id.sha256) {
                        shas.push(block.block_id.sha256.clone());
                    }
                }
                for sha in &shas {
                    if self.index.remove_block(sha)? {
                        source.delete_blocks(&[sha.clone()]).await?;
                    }
                }
            }
            self.index.delete_snapshot(&id)?;
            self.remove_placement(&id).await;
            deleted += 1;
        }
        Ok(deleted)
    }

    /// Move all backups flagged by `evaluate_movement` / `evaluate_archival`
    /// and then apply retention. Returns total bytes moved.
    pub async fn execute_policy(&self, policy: &SobrPolicy) -> Result<u64> {
        let mut moved = 0u64;
        for id in self.evaluate_movement(policy).await? {
            moved += self
                .move_backup(&id, &policy.performance_tier_id, &policy.capacity_tier_id)
                .await?;
        }
        if let Some(archive) = &policy.archive_tier_id {
            for id in self.evaluate_archival(policy).await? {
                moved += self
                    .move_backup(&id, &policy.capacity_tier_id, archive)
                    .await?;
            }
        }
        self.seal_expired(policy).await?;
        self.apply_retention(policy).await?;
        Ok(moved)
    }

    // ---- internals ----

    /// A backup without a recorded placement is assumed to live on the
    /// performance (initial write) tier, so `default_tier` is used in that case.
    async fn is_sealed(&self, backup_id: &str, default_tier: &str) -> Result<bool> {
        let tier = match self.placement(backup_id).await {
            Some(t) => t,
            None => default_tier.to_string(),
        };
        Ok(self.tier_backend(&tier).await?.is_sealed(backup_id).await?)
    }

    /// (backup_id, current_tier_id) for every snapshot at least `days` old.
    /// Backups without a recorded placement carry `None` (initial write tier).
    async fn age_evaluate(&self, days: u64) -> Result<Vec<(String, Option<String>)>> {
        let now = Utc::now().timestamp();
        let cutoff = now.saturating_sub((days as i64).saturating_mul(86_400));

        let placements = self.placements.read().await;
        let mut out = Vec::new();
        for snap in self.index.list_all_snapshots()? {
            if snap.created_at > cutoff {
                continue;
            }
            let tier = placements.get(&snap.id).cloned();
            out.push((snap.id, tier));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::BlockIndex;
    use crate::snapshot::SnapshotManager;
    use crate::storage::local::LocalStorage;
    use crate::types::{BlockId, FileBlock, FileMetadata, SnapshotType};

    fn temp_dir(tag: &str) -> String {
        let dir = std::env::temp_dir()
            .join(format!("bck-sobr-eng-{}-{}", tag, uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn policy(perf: &str, cap: &str) -> SobrPolicy {
        SobrPolicy {
            id: "p1".into(),
            name: "test".into(),
            performance_tier_id: perf.into(),
            capacity_tier_id: cap.into(),
            archive_tier_id: None,
            capacity_move_days: 30,
            archive_move_days: None,
            seal_days: None,
            retention_days: None,
        }
    }

    /// Register a snapshot referencing the given block sha256s, backdated to
    /// `days_old`, and write the blocks to the index's block table.
    fn seed_backup(index_path: &str, index: &Arc<BlockIndex>, shas: &[&str], days_old: i64) -> String {
        let blocks = shas
            .iter()
            .map(|sha| FileBlock {
                relative_path: "f.txt".into(),
                offset: 0,
                size: sha.len() as u32,
                block_id: BlockId {
                    sha256: sha.to_string(),
                    size: sha.len() as u32,
                },
                metadata: FileMetadata {
                    path: "f.txt".into(),
                    size: sha.len() as u64,
                    modified_time: 0,
                    mode: 0o644,
                    owner: String::new(),
                    group: String::new(),
                    extended_attributes: Default::default(),
                    acl: Vec::new(),
                },
            })
            .collect::<Vec<_>>();

        let sm = SnapshotManager::new(index_path).unwrap();
        let snap = sm
            .create_snapshot("job1", "repo1", &SnapshotType::Full, None, blocks)
            .unwrap();
        let now = Utc::now().timestamp();
        index
            .set_snapshot_created_at(&snap.id, now - days_old * 86_400)
            .unwrap();
        for sha in shas {
            index
                .add_block(
                    &BlockId { sha256: sha.to_string(), size: sha.len() as u32 },
                    sha.len() as u64,
                    "perf",
                )
                .unwrap();
        }
        snap.id
    }

    #[tokio::test]
    async fn evaluate_movement_flags_only_aged_perf_backups() {
        let idx_path = temp_dir("idx");
        let index = Arc::new(BlockIndex::new(&idx_path).unwrap());
        let engine = DataLifecycleEngine::new(index.clone());

        engine
            .register_tier_backend(TierBackend::new("perf", Box::new(LocalStorage::new(&temp_dir("perf")).unwrap())))
            .await
            .unwrap();
        engine
            .register_tier_backend(TierBackend::new("cap", Box::new(LocalStorage::new(&temp_dir("cap")).unwrap())))
            .await
            .unwrap();

        let old = seed_backup(&idx_path, &index, &["aaa"], 40);
        let fresh = seed_backup(&idx_path, &index, &["bbb"], 1);

        let mut moved = engine.evaluate_movement(&policy("perf", "cap")).await.unwrap();
        moved.sort();
        assert_eq!(moved, vec![old]);
        assert!(!moved.contains(&fresh));
    }

    #[tokio::test]
    async fn move_backup_moves_blocks_and_updates_placement() {
        let idx_path = temp_dir("idx");
        let index = Arc::new(BlockIndex::new(&idx_path).unwrap());
        let engine = DataLifecycleEngine::new(index.clone());

        let perf_path = temp_dir("perf");
        let cap_path = temp_dir("cap");
        let perf = TierBackend::new("perf", Box::new(LocalStorage::new(&perf_path).unwrap()));
        let cap = TierBackend::new("cap", Box::new(LocalStorage::new(&cap_path).unwrap()));
        engine.register_tier_backend(perf).await.unwrap();
        engine.register_tier_backend(cap).await.unwrap();

        let id = seed_backup(&idx_path, &index, &["abc"], 1);
        let perf_backend = engine.tier_backend("perf").await.unwrap();
        perf_backend.storage().write_block("abc", b"data").await.unwrap();

        let moved = engine.move_backup(&id, "perf", "cap").await.unwrap();
        assert_eq!(moved, 4);

        assert_eq!(engine.placement(&id).await, Some("cap".to_string()));
        assert!(!perf_backend.storage().exists("abc").await.unwrap());
        let cap_backend = engine.tier_backend("cap").await.unwrap();
        assert_eq!(cap_backend.storage().read_block("abc").await.unwrap(), b"data");
    }

    #[tokio::test]
    async fn shared_blocks_stay_on_source_after_move() {
        let idx_path = temp_dir("idx");
        let index = Arc::new(BlockIndex::new(&idx_path).unwrap());
        let engine = DataLifecycleEngine::new(index.clone());

        let perf_path = temp_dir("perf");
        let cap_path = temp_dir("cap");
        engine
            .register_tier_backend(TierBackend::new("perf", Box::new(LocalStorage::new(&perf_path).unwrap())))
            .await
            .unwrap();
        engine
            .register_tier_backend(TierBackend::new("cap", Box::new(LocalStorage::new(&cap_path).unwrap())))
            .await
            .unwrap();

        // Two backups share the same block -> refcount 2.
        let id1 = seed_backup(&idx_path, &index, &["abc"], 1);
        let _id2 = seed_backup(&idx_path, &index, &["abc"], 1);
        let perf_backend = engine.tier_backend("perf").await.unwrap();
        perf_backend.storage().write_block("abc", b"data").await.unwrap();

        let moved = engine.move_backup(&id1, "perf", "cap").await.unwrap();
        assert_eq!(moved, 4);

        // Refcount dropped 2 -> 1, so the physical block stays on source.
        assert!(perf_backend.storage().exists("abc").await.unwrap());
        let cap_backend = engine.tier_backend("cap").await.unwrap();
        assert!(cap_backend.storage().exists("abc").await.unwrap());
    }

    #[tokio::test]
    async fn apply_retention_deletes_only_expired() {
        let idx_path = temp_dir("idx");
        let index = Arc::new(BlockIndex::new(&idx_path).unwrap());
        let engine = DataLifecycleEngine::new(index.clone());

        let perf_path = temp_dir("perf");
        let perf = TierBackend::new("perf", Box::new(LocalStorage::new(&perf_path).unwrap()));
        engine.register_tier_backend(perf).await.unwrap();

        let old = seed_backup(&idx_path, &index, &["old1"], 40);
        let fresh = seed_backup(&idx_path, &index, &["new1"], 1);
        let perf_backend = engine.tier_backend("perf").await.unwrap();
        perf_backend.storage().write_block("old1", b"x").await.unwrap();
        perf_backend.storage().write_block("new1", b"y").await.unwrap();

        let mut p = policy("perf", "cap");
        p.retention_days = Some(30);
        let deleted = engine.apply_retention(&p).await.unwrap();
        assert_eq!(deleted, 1);

        assert_eq!(engine.placement(&old).await, None);
        assert!(!perf_backend.storage().exists("old1").await.unwrap());
        assert!(perf_backend.storage().exists("new1").await.unwrap());
        let remaining = index.list_all_snapshots().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, fresh);
    }

    #[tokio::test]
    async fn sealed_backups_are_protected_from_cleanup() {
        let idx_path = temp_dir("idx");
        let index = Arc::new(BlockIndex::new(&idx_path).unwrap());
        let engine = DataLifecycleEngine::new(index.clone());

        let perf_path = temp_dir("perf");
        let perf = TierBackend::new("perf", Box::new(LocalStorage::new(&perf_path).unwrap()));
        engine.register_tier_backend(perf).await.unwrap();

        let id = seed_backup(&idx_path, &index, &["keep"], 40);
        let perf_backend = engine.tier_backend("perf").await.unwrap();
        perf_backend.storage().write_block("keep", b"z").await.unwrap();

        let mut p = policy("perf", "cap");
        p.seal_days = Some(10);
        p.retention_days = Some(20);
        assert_eq!(engine.seal_expired(&p).await.unwrap(), 1);
        assert_eq!(engine.apply_retention(&p).await.unwrap(), 0);

        assert!(perf_backend.is_sealed(&id).await.unwrap());
        assert!(perf_backend.storage().exists("keep").await.unwrap());
    }

    #[tokio::test]
    async fn evaluate_archival_flags_capacity_backups() {
        let idx_path = temp_dir("idx");
        let index = Arc::new(BlockIndex::new(&idx_path).unwrap());
        let engine = DataLifecycleEngine::new(index.clone());

        engine
            .register_tier_backend(TierBackend::new("perf", Box::new(LocalStorage::new(&temp_dir("perf")).unwrap())))
            .await
            .unwrap();
        engine
            .register_tier_backend(TierBackend::new("cap", Box::new(LocalStorage::new(&temp_dir("cap")).unwrap())))
            .await
            .unwrap();
        engine
            .register_tier_backend(TierBackend::new("arch", Box::new(LocalStorage::new(&temp_dir("arch")).unwrap())))
            .await
            .unwrap();

        let on_cap = seed_backup(&idx_path, &index, &["ccc"], 20);
        engine.set_placement(&on_cap, "cap").await;
        let on_perf = seed_backup(&idx_path, &index, &["ddd"], 20);

        let mut p = policy("perf", "cap");
        p.archive_tier_id = Some("arch".into());
        p.archive_move_days = Some(15);
        let mut candidates = engine.evaluate_archival(&p).await.unwrap();
        candidates.sort();
        assert_eq!(candidates, vec![on_cap]);
        assert!(!candidates.contains(&on_perf));
    }

    #[tokio::test]
    async fn execute_policy_moves_then_retains() {
        let idx_path = temp_dir("idx");
        let index = Arc::new(BlockIndex::new(&idx_path).unwrap());
        let engine = DataLifecycleEngine::new(index.clone());

        let perf_path = temp_dir("perf");
        let cap_path = temp_dir("cap");
        engine
            .register_tier_backend(TierBackend::new("perf", Box::new(LocalStorage::new(&perf_path).unwrap())))
            .await
            .unwrap();
        engine
            .register_tier_backend(TierBackend::new("cap", Box::new(LocalStorage::new(&cap_path).unwrap())))
            .await
            .unwrap();

        let id = seed_backup(&idx_path, &index, &["zzz"], 40);
        let perf_backend = engine.tier_backend("perf").await.unwrap();
        perf_backend.storage().write_block("zzz", b"wxyz").await.unwrap();

        let mut p = policy("perf", "cap");
        p.capacity_move_days = 30;
        p.retention_days = Some(200);
        let moved = engine.execute_policy(&p).await.unwrap();
        assert_eq!(moved, 4);

        assert_eq!(engine.placement(&id).await, Some("cap".to_string()));
        assert!(engine.tier_backend("cap").await.unwrap().storage().exists("zzz").await.unwrap());
        assert!(!perf_backend.storage().exists("zzz").await.unwrap());
    }
}
