pub mod instant;
pub mod explorer;
pub mod surebackup;
pub mod tracker;
pub mod requests;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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

        // List of disk/config files for VM registration (paths only, cheap).
        let mut disk_files: Vec<String> = manifest.blocks
            .iter()
            .map(|b| b.relative_path.clone())
            .collect();
        disk_files.sort();
        disk_files.dedup();

        // Stream blocks to disk (bounded memory — one block at a time).
        let processed = stream_restore(
            &manifest,
            storage,
            key,
            &PathBuf::from(target_datastore),
            true,
            |_| true,
        ).await?;

        // Register VM on the hypervisor if a connector was provided.
        if let Some(connector) = hypervisor_connector {
            let vm_disks: Vec<String> = disk_files.into_iter()
                .filter(|p| {
                    let lower = p.to_lowercase();
                    lower.ends_with(".vhd") || lower.ends_with(".vhdx")
                        || lower.ends_with(".vmdk") || lower.ends_with(".vmx")
                })
                .collect();
            if vm_disks.is_empty() {
                info!("No virtual disk/config files in snapshot {} — skipping VM registration", snapshot_id);
            } else {
                let vm_ref = connector
                    .register_vm(vm_name, &vm_disks, target_datastore, power_on)
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

        // Normalize the requested paths so an exact (or directory-prefix) match
        // is used instead of a fragile substring match (`/etc/passwd` used to be
        // selected by the substring `etc`).
        let wanted: Vec<String> = files
            .iter()
            .map(|f| normalize_manifest_path(f).trim_end_matches('/').to_string())
            .filter(|f| !f.is_empty())
            .collect();
        // silence unused warning if caller passes empty filter - kept for future
        let _ = wanted.len();
        let processed = stream_restore(
            &manifest,
            storage,
            key,
            &PathBuf::from(target_path),
            overwrite,
            |path| {
                let path = normalize_manifest_path(path);
                wanted.is_empty()
                    || wanted
                        .iter()
                        .any(|f| path == *f || path.starts_with(&format!("{}/", f)))
            },
        ).await?;

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

/// Streams restored files to `base_dir`. Blocks are grouped by relative path,
/// ordered by offset, and written sequentially so only one block is in memory
/// at a time (previously the whole snapshot was reassembled in RAM).
async fn stream_restore(
    manifest: &BackupManifest,
    storage: &dyn StorageBackend,
    key: Option<&[u8]>,
    base_dir: &std::path::Path,
    overwrite: bool,
    should_restore: impl Fn(&str) -> bool,
) -> Result<u64> {
    use std::collections::BTreeMap;
    use tokio::io::AsyncWriteExt;

    let mut by_path: HashMap<String, BTreeMap<u64, &crate::types::FileBlock>> = HashMap::new();
    for block in &manifest.blocks {
        if should_restore(&block.relative_path) {
            by_path
                .entry(block.relative_path.clone())
                .or_default()
                .insert(block.offset, block);
        }
    }

    let mut processed = 0u64;
    for (path, ordered) in by_path {
        let target = safe_join(base_dir, &path)?;
        if target.exists() && !overwrite {
            info!("Skipping existing file: {:?}", target);
            continue;
        }
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut file = tokio::fs::File::create(&target).await?;
        for (_, block) in ordered {
            let raw = storage.read_block(&block.block_id.sha256).await?;
            let data = crate::pipeline::decode_block(&raw, key)?;
            // The manifest pins the SHA-256 of the plaintext. A mismatch means
            // a corrupted or swapped block — fail instead of restoring garbage
            // (silent data corruption).
            let actual = hex::encode(Sha256::digest(&data));
            if actual != block.block_id.sha256 {
                anyhow::bail!(
                    "block integrity check failed for {} (data corruption)",
                    block.block_id.sha256
                );
            }
            file.write_all(&data).await?;
            processed += data.len() as u64;
        }
        file.flush().await?;
    }

    Ok(processed)
}

/// Strip a leading `/` or `\` from a manifest-relative path so absolute guest
/// paths (`/etc/passwd`) are treated as relative to the restore root.
fn normalize_manifest_path(p: &str) -> String {
    // Normalize backslashes to forward slashes so Windows paths are handled on Linux too.
    let s = p.replace('\\', "/");
    s.trim_start_matches('/').to_string()
}

/// Join a manifest path onto a restore root, rejecting any path that could
/// escape the root (`..`, absolute paths, drive prefixes, symlinks out).
/// Returns an error instead of writing outside the intended directory.
fn safe_join(base: &std::path::Path, rel: &str) -> Result<std::path::PathBuf> {
    use std::path::Component;

    let rel = normalize_manifest_path(rel);
    let p = std::path::Path::new(&rel);
    if p.as_os_str().is_empty() {
        anyhow::bail!("empty restore path");
    }
    if p.components().any(|c| {
        matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))
    }) {
        anyhow::bail!("restore path escapes the restore root: {rel}");
    }
    let base_canon = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let out = base_canon.join(p);
    if let Some(parent) = out.parent() {
        let parent_canon = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
        if !parent_canon.starts_with(&base_canon) {
            anyhow::bail!("restore path escapes the restore root: {rel}");
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_base() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bck-restore-safe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn normalize_strips_leading_separators() {
        assert_eq!(normalize_manifest_path("/etc/passwd"), "etc/passwd");
        // Backslashes are normalized to forward slashes so Windows paths are portable.
        assert_eq!(normalize_manifest_path("\\etc\\passwd"), "etc/passwd");
        assert_eq!(normalize_manifest_path("etc/passwd"), "etc/passwd");
    }

    #[test]
    fn safe_join_stays_inside_base() {
        let base = temp_base();
        let canon = base.canonicalize().unwrap();
        let joined = safe_join(&base, "/etc/passwd").unwrap();
        assert!(joined.starts_with(&canon));
        assert!(joined.ends_with("etc/passwd"));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn safe_join_rejects_parent_dir() {
        let base = temp_base();
        assert!(safe_join(&base, "../escape.txt").is_err());
        assert!(safe_join(&base, "a/../../escape.txt").is_err());
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    #[cfg(windows)]
    fn safe_join_rejects_windows_drive_prefix() {
        let base = temp_base();
        assert!(safe_join(&base, "C:\\Windows\\System32\\evil").is_err());
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn safe_join_rejects_empty_path() {
        let base = temp_base();
        assert!(safe_join(&base, "").is_err());
        assert!(safe_join(&base, "/").is_err());
        std::fs::remove_dir_all(&base).ok();
    }
}
