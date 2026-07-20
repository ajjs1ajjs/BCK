pub mod instant;
pub mod explorer;
pub mod surebackup;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::info;

use crate::compress::Compressor;
use crate::dedup::DedupEngine;
use crate::index::BlockIndex;
use crate::storage::StorageBackend;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RestoreType {
    /// Full VM restore to original location
    FullVm,
    /// Full VM restore to alternate location
    FullVmAlternate,
    /// File-level restore from VM snapshot
    FileLevel,
    /// Application item restore (SQL DB, mailbox, etc.)
    ApplicationItem,
    /// Instant Recovery via NFS
    InstantNfs,
    /// Instant Recovery via iSCSI
    InstantIscsi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreSession {
    pub id: String,
    pub snapshot_id: String,
    pub restore_type: RestoreType,
    pub status: RestoreStatus,
    pub progress_pct: f64,
    pub bytes_processed: u64,
    pub total_bytes: u64,
    pub target: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RestoreStatus {
    Pending,
    Running,
    Completed,
    Failed(String),
    Cancelled,
}

pub struct RestoreOrchestrator {
    index: BlockIndex,
    dedup: DedupEngine,
}

impl RestoreOrchestrator {
    pub fn new(index_path: &str) -> Result<Self> {
        let index = BlockIndex::new(index_path)?;
        let dedup = DedupEngine::new(Some(index_path))?;
        Ok(Self { index, dedup })
    }

    pub async fn restore_vm(
        &self,
        snapshot_id: &str,
        target_datastore: &str,
        storage: &dyn StorageBackend,
        hypervisor_connector: Option<&dyn crate::integrations::HypervisorConnector>,
    ) -> Result<RestoreSession> {
        let session_id = uuid::Uuid::new_v4().to_string();
        info!("Starting VM restore: snapshot={}, target={}", snapshot_id, target_datastore);

        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id))?;

        let total_bytes = manifest.total_size;
        let mut processed: u64 = 0;

        for block in &manifest.blocks {
            // Read encrypted block from storage
            let encrypted = storage.read_block(&block.block_id.sha256).await?;

            // Decrypt (in production, use encrypt module)
            let compressed = encrypted;

            // Decompress
            let data = crate::compress::ZstdCompressor::new(3)
                .decompress(&compressed)?;

            // Write to target location
            let target_path = PathBuf::from(target_datastore).join(&block.relative_path);
            if let Some(parent) = target_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&target_path, &data).await?;

            processed += data.len() as u64;
        }

        // Register VM on hypervisor if connector is provided
        if let Some(connector) = hypervisor_connector {
            // TODO: register VM from restored files
            info!("VM registration would happen here");
        }

        Ok(RestoreSession {
            id: session_id,
            snapshot_id: snapshot_id.to_string(),
            restore_type: RestoreType::FullVm,
            status: RestoreStatus::Completed,
            progress_pct: 100.0,
            bytes_processed: processed,
            total_bytes,
            target: target_datastore.to_string(),
            started_at: chrono::Utc::now().timestamp(),
            finished_at: Some(chrono::Utc::now().timestamp()),
            error: None,
        })
    }

    pub async fn restore_file(
        &self,
        snapshot_id: &str,
        files: &[String],
        target_path: &str,
        storage: &dyn StorageBackend,
        overwrite: bool,
    ) -> Result<RestoreSession> {
        let session_id = uuid::Uuid::new_v4().to_string();
        info!("Starting file restore: snapshot={}, files={:?}", snapshot_id, files);

        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id))?;

        let mut processed = 0u64;

        for block in &manifest.blocks {
            // Check if this file is requested
            let should_restore = files.is_empty() || files.iter().any(|f| block.relative_path.contains(f));
            if !should_restore {
                continue;
            }

            let encrypted = storage.read_block(&block.block_id.sha256).await?;
            let data = crate::compress::ZstdCompressor::new(3).decompress(&encrypted)?;

            let target = PathBuf::from(target_path).join(&block.relative_path);
            if target.exists() && !overwrite {
                info!("Skipping existing file: {:?}", target);
                continue;
            }

            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            tokio::fs::write(&target, &data).await?;
            processed += data.len() as u64;
        }

        Ok(RestoreSession {
            id: session_id,
            snapshot_id: snapshot_id.to_string(),
            restore_type: RestoreType::FileLevel,
            status: RestoreStatus::Completed,
            progress_pct: 100.0,
            bytes_processed: processed,
            total_bytes: processed,
            target: target_path.to_string(),
            started_at: chrono::Utc::now().timestamp(),
            finished_at: Some(chrono::Utc::now().timestamp()),
            error: None,
        })
    }

    pub async fn list_snapshot_files(&self, snapshot_id: &str) -> Result<Vec<String>> {
        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id))?;

        let mut files: Vec<String> = manifest.blocks
            .iter()
            .map(|b| b.relative_path.clone())
            .collect();
        files.sort();
        files.dedup();

        Ok(files)
    }
}
