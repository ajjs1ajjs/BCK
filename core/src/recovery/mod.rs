use anyhow::Result;
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::snapshot::SnapshotManager;
use crate::storage::StorageBackend;


pub struct RecoveryEngine {
    snapshot_mgr: SnapshotManager,
}

impl RecoveryEngine {
    pub fn new(index_path: &str) -> Result<Self> {
        let snapshot_mgr = SnapshotManager::new(index_path)?;
        Ok(Self { snapshot_mgr })
    }

    pub async fn restore_file_level(
        &self,
        snapshot_id: &str,
        target_path: &str,
        storage: &dyn StorageBackend,
        include_patterns: &[String],
        exclude_patterns: &[String],
        overwrite: bool,
    ) -> Result<RestoreStats> {
        let manifest = self.snapshot_mgr.get_manifest(snapshot_id)?
            .ok_or_else(|| anyhow::anyhow!("Snapshot not found: {}", snapshot_id))?;

        let target = PathBuf::from(target_path);
        let mut stats = RestoreStats::default();

        for block in &manifest.blocks {
            if !should_include(&block.relative_path, include_patterns, exclude_patterns) {
                continue;
            }

            let file_path = target.join(&block.relative_path);
            if file_path.exists() && !overwrite {
                stats.skipped += 1;
                continue;
            }

            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent).await?;
            }

            let encrypted = storage.read_block(&block.block_id.sha256).await?;
            // Decrypt/decompress handled by pipeline
            // For now, write raw data
            let mut file = fs::File::create(&file_path).await?;
            file.write_all(&encrypted).await?;

            stats.restored_files += 1;
            stats.restored_bytes += encrypted.len() as u64;
        }

        Ok(stats)
    }

    pub async fn restore_full(
        &self,
        _snapshot_id: &str,
        _storage: &dyn StorageBackend,
    ) -> Result<RestoreStats> {
        anyhow::bail!("Full restore not yet implemented")
    }
}

#[derive(Debug, Default)]
pub struct RestoreStats {
    pub restored_files: u64,
    pub restored_bytes: u64,
    pub skipped: u64,
    pub failed: u64,
}

fn should_include(path: &str, includes: &[String], excludes: &[String]) -> bool {
    if !includes.is_empty() {
        if !includes.iter().any(|p| path.contains(p)) {
            return false;
        }
    }
    if excludes.iter().any(|p| path.contains(p)) {
        return false;
    }
    true
}
