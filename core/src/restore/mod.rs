pub mod instant;
pub mod explorer;
pub mod surebackup;
pub mod tracker;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::info;

use crate::index::BlockIndex;
use crate::storage::StorageBackend;
use crate::types::BackupManifest;

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
}

impl RestoreOrchestrator {
    pub fn new(index_path: &str) -> Result<Self> {
        let index = BlockIndex::new(index_path)?;
        Ok(Self { index })
    }

    pub async fn restore_vm(
        &self,
        snapshot_id: &str,
        target_datastore: &str,
        storage: &dyn StorageBackend,
        key: Option<&[u8]>,
        hypervisor_connector: Option<&dyn crate::integrations::HypervisorConnector>,
        vm_name: &str,
        power_on: bool,
    ) -> Result<RestoreSession> {
        let session_id = uuid::Uuid::new_v4().to_string();
        info!("Starting VM restore: snapshot={}, target={}", snapshot_id, target_datastore);

        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id))?;

        let total_bytes = manifest.total_size;
        let mut processed: u64 = 0;

        let files = assemble_files(&manifest, storage, key).await?;
        for (path, data) in &files {
            let target_path = PathBuf::from(target_datastore).join(path);
            if let Some(parent) = target_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&target_path, data).await?;
            processed += data.len() as u64;
        }

        // Register VM on the hypervisor if a connector was provided.
        if let Some(connector) = hypervisor_connector {
            let disk_files: Vec<String> = files.keys()
                .filter(|p| {
                    let lower = p.to_lowercase();
                    lower.ends_with(".vhd") || lower.ends_with(".vhdx")
                        || lower.ends_with(".vmdk") || lower.ends_with(".vmx")
                })
                .cloned()
                .collect();
            if disk_files.is_empty() {
                info!("No virtual disk/config files in snapshot {} — skipping VM registration", snapshot_id);
            } else {
                let vm_ref = connector
                    .register_vm(vm_name, &disk_files, target_datastore, power_on)
                    .await?;
                info!("Registered restored VM '{}' on hypervisor as {}", vm_name, vm_ref);
            }
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
        key: Option<&[u8]>,
        overwrite: bool,
    ) -> Result<RestoreSession> {
        let session_id = uuid::Uuid::new_v4().to_string();
        info!("Starting file restore: snapshot={}, files={:?}", snapshot_id, files);

        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id))?;

        let all = assemble_files(&manifest, storage, key).await?;
        let mut processed = 0u64;

        for (path, data) in &all {
            // Check if this file is requested
            let should_restore = files.is_empty() || files.iter().any(|f| path.contains(f.as_str()));
            if !should_restore {
                continue;
            }

            let target = PathBuf::from(target_path).join(path);
            if target.exists() && !overwrite {
                info!("Skipping existing file: {:?}", target);
                continue;
            }

            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            tokio::fs::write(&target, data).await?;
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

    pub fn count_blocks(&self, snapshot_id: &str) -> Result<usize> {
        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id))?;
        Ok(manifest.blocks.len())
    }
}

/// Reassembles whole files from their chunks. Chunks are grouped by relative
/// path, ordered by offset, then concatenated. Each stored block is decoded
/// (decompressed / decrypted) using the shared block magic format.
async fn assemble_files(
    manifest: &BackupManifest,
    storage: &dyn StorageBackend,
    key: Option<&[u8]>,
) -> Result<HashMap<String, Vec<u8>>> {
    use std::collections::BTreeMap;

    let mut parts: HashMap<String, BTreeMap<u64, Vec<u8>>> = HashMap::new();
    for block in &manifest.blocks {
        let raw = storage.read_block(&block.block_id.sha256).await?;
        let data = crate::pipeline::decode_block(&raw, key)?;
        parts
            .entry(block.relative_path.clone())
            .or_default()
            .insert(block.offset, data);
    }

    let mut files = HashMap::new();
    for (path, ordered) in parts {
        let mut buf = Vec::new();
        for (_, mut part) in ordered {
            buf.append(&mut part);
        }
        files.insert(path, buf);
    }
    Ok(files)
}
