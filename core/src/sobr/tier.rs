use anyhow::{Result, anyhow};
use std::time::Instant;

use crate::storage::{StorageBackend, StorageConfig, StorageStats, create_backend};

use super::StorageTier;

/// A single SOBR tier bound to a concrete storage backend. All data-plane
/// operations (health, copy, delete, seal) run against the real backend.
pub struct TierBackend {
    tier_id: String,
    backend: Box<dyn StorageBackend>,
}

#[derive(Debug, Clone)]
pub struct TierHealth {
    pub online: bool,
    pub free_bytes: u64,
    pub used_bytes: u64,
    pub read_latency_ms: f64,
    pub write_latency_ms: f64,
    pub total_blocks: u64,
}

/// Marker namespace for sealed backups. Sealed backups are immutable and are
/// excluded from cleanup.
const SEAL_PREFIX: &str = "_seal/";

/// Single well-known block id persisting the set of sealed backups. Stored via
/// exact-key reads/writes so it round-trips on any backend (LocalStorage and
/// S3 hash full block ids, making prefix-based enumeration of the seal
/// namespace impossible).
const SEAL_INDEX: &str = "_seal/index";

impl TierBackend {
    pub fn new(tier_id: &str, backend: Box<dyn StorageBackend>) -> Self {
        Self {
            tier_id: tier_id.to_string(),
            backend,
        }
    }

    /// Open a backend for a configured tier from its `backend_config`.
    pub async fn from_tier(tier: &StorageTier) -> Result<Self> {
        let mut config: StorageConfig = serde_json::from_value(tier.backend_config.clone())
            .map_err(|e| anyhow!("Invalid backend config for tier {}: {}", tier.name, e))?;
        if !tier.backend.is_empty() {
            config.backend_type = tier.backend.clone();
        }
        let backend = create_backend(config).await?;
        Ok(Self::new(&tier.id, backend))
    }

    pub fn tier_id(&self) -> &str {
        &self.tier_id
    }

    pub fn backend_type(&self) -> &'static str {
        self.backend.backend_type()
    }

    pub fn name(&self) -> &str {
        self.backend.name()
    }

    /// Access to the underlying storage backend (for direct I/O).
    pub fn storage(&self) -> &dyn StorageBackend {
        self.backend.as_ref()
    }

    /// Real health probe: connection check plus round-trip latency samples.
    pub async fn health_check(&self) -> Result<TierHealth> {
        let read_start = Instant::now();
        self.backend.test_connection().await?;
        let read_latency_ms = read_start.elapsed().as_secs_f64() * 1000.0;

        let stats = self.backend.stats().await?;

        let probe = format!("{}{}", SEAL_PREFIX, "_health_probe");
        let write_start = Instant::now();
        self.backend.write_block(&probe, b"probe").await?;
        let write_latency_ms = write_start.elapsed().as_secs_f64() * 1000.0;
        self.backend.delete_block(&probe).await?;

        Ok(TierHealth {
            online: true,
            free_bytes: stats.free_bytes,
            used_bytes: stats.used_bytes,
            read_latency_ms,
            write_latency_ms,
            total_blocks: stats.total_blocks,
        })
    }

    pub async fn stats(&self) -> Result<StorageStats> {
        self.backend.stats().await
    }

    /// Copy blocks into `target`, verifying each landed before moving on.
    /// Returns the number of bytes copied. Source blocks are left untouched.
    pub async fn copy_blocks_to(
        &self,
        target: &TierBackend,
        block_ids: &[String],
    ) -> Result<u64> {
        let mut copied = 0u64;
        for id in block_ids {
            let data = self.backend.read_block(id).await?;
            target.backend.write_block(id, &data).await?;
            if !target.backend.exists(id).await? {
                return Err(anyhow!("Block {} failed integrity check on target", id));
            }
            copied += data.len() as u64;
        }
        Ok(copied)
    }

    /// Delete blocks, returning how many were removed.
    pub async fn delete_blocks(&self, block_ids: &[String]) -> Result<u64> {
        let mut deleted = 0u64;
        for id in block_ids {
            if self.backend.exists(id).await? {
                self.backend.delete_block(id).await?;
                deleted += 1;
            }
        }
        Ok(deleted)
    }

    /// Seal a backup: records it as immutable so cleanup skips it.
    pub async fn seal_backup(&self, backup_id: &str) -> Result<()> {
        let mut sealed = self.sealed_backups().await?;
        if !sealed.iter().any(|s| s == backup_id) {
            sealed.push(backup_id.to_string());
        }
        sealed.sort();
        let payload = serde_json::json!({
            "sealed_at": chrono::Utc::now().timestamp(),
            "backups": sealed,
        });
        self.backend
            .write_block(SEAL_INDEX, payload.to_string().as_bytes())
            .await
    }

    pub async fn is_sealed(&self, backup_id: &str) -> Result<bool> {
        Ok(self.sealed_backups().await?.iter().any(|s| s == backup_id))
    }

    pub async fn sealed_backups(&self) -> Result<Vec<String>> {
        match self.backend.read_block(SEAL_INDEX).await {
            Ok(data) => {
                let json: serde_json::Value = serde_json::from_slice(&data)?;
                Ok(json["backups"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default())
            }
            Err(_) => Ok(Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sobr::StorageTier;
    use crate::storage::local::LocalStorage;
    use crate::sobr::TierType;
    use crate::sobr::TierStatus;

    fn temp_dir(tag: &str) -> String {
        let dir = std::env::temp_dir()
            .join(format!("bck-sobr-{}-{}", tag, uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn health_check_reports_real_stats() {
        let path = temp_dir("health");
        let backend = Box::new(LocalStorage::new(&path).unwrap());
        let tier = TierBackend::new("perf", backend);
        tier.backend.write_block("a", b"1").await.unwrap();
        tier.backend.write_block("b", b"22").await.unwrap();

        let health = tier.health_check().await.unwrap();
        assert!(health.online);
        assert_eq!(health.total_blocks, 2);
        assert!(health.used_bytes >= 3);
        assert!(health.read_latency_ms >= 0.0);
        assert!(health.write_latency_ms >= 0.0);
    }

    #[tokio::test]
    async fn copy_blocks_to_copies_and_verifies() {
        let src_path = temp_dir("copy-src");
        let dst_path = temp_dir("copy-dst");
        let src = TierBackend::new("perf", Box::new(LocalStorage::new(&src_path).unwrap()));
        let dst = TierBackend::new("cap", Box::new(LocalStorage::new(&dst_path).unwrap()));

        src.backend.write_block("blk", b"hello").await.unwrap();
        let copied = src.copy_blocks_to(&dst, &["blk".to_string()]).await.unwrap();
        assert_eq!(copied, 5);

        assert_eq!(dst.backend.read_block("blk").await.unwrap(), b"hello");
        assert!(src.backend.exists("blk").await.unwrap());
    }

    #[tokio::test]
    async fn delete_blocks_removes_only_existing() {
        let path = temp_dir("del");
        let tier = TierBackend::new("perf", Box::new(LocalStorage::new(&path).unwrap()));
        tier.backend.write_block("x", b"1").await.unwrap();
        tier.backend.write_block("y", b"2").await.unwrap();

        let deleted = tier
            .delete_blocks(&["x".to_string(), "missing".to_string()])
            .await
            .unwrap();
        assert_eq!(deleted, 1);
        assert!(!tier.backend.exists("x").await.unwrap());
        assert!(tier.backend.exists("y").await.unwrap());
    }

    #[tokio::test]
    async fn seal_roundtrip() {
        let path = temp_dir("seal");
        let tier = TierBackend::new("perf", Box::new(LocalStorage::new(&path).unwrap()));

        assert!(!tier.is_sealed("bk1").await.unwrap());
        tier.seal_backup("bk1").await.unwrap();

        assert!(tier.is_sealed("bk1").await.unwrap());
        let sealed = tier.sealed_backups().await.unwrap();
        assert!(sealed.contains(&"bk1".to_string()));
    }

    #[tokio::test]
    async fn from_tier_builds_configured_backend() {
        let path = temp_dir("from-tier");
        let tier = StorageTier {
            id: "perf".into(),
            name: "Perf".into(),
            tier_type: TierType::Performance,
            backend: String::new(),
            backend_config: serde_json::json!({ "backend_type": "local", "path": path }),
            capacity_bytes: 0,
            used_bytes: 0,
            status: TierStatus::Online,
            priority: 1,
        };
        let backend = TierBackend::from_tier(&tier).await.unwrap();
        let health = backend.health_check().await.unwrap();
        assert!(health.online);
        assert_eq!(backend.backend_type(), "local");
    }
}
