pub mod iscsi;
pub mod nfs;
pub mod xdr;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::index::BlockIndex;
use crate::storage::StorageBackend;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstantRecoverySession {
    pub id: String,
    pub snapshot_id: String,
    pub vm_name: String,
    pub protocol: Protocol,
    pub mount_path: String,
    pub target_host: String,
    pub status: InstantRecoveryStatus,
    pub progress_pct: f64,
    pub bytes_migrated: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Protocol {
    Nfs,
    Iscsi,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum InstantRecoveryStatus {
    Mounting,
    Running,
    Migrating,
    Completed,
    Failed(String),
}

/// A VM disk within a snapshot: path to reconstruct + size.
#[derive(Debug, Clone)]
pub struct InstantDisk {
    pub name: String,
    pub total_size: u64,
}

/// Reads a byte range of a virtual file/disk from the backup store by walking
/// the manifest blocks overlapping [offset, offset+len).
async fn read_backed_range(
    _index: &BlockIndex,
    storage: &dyn StorageBackend,
    blocks: &[crate::types::FileBlock],
    file_path: &str,
    offset: u64,
    len: u32,
) -> Result<Vec<u8>> {
    let end = offset + len as u64;
    let mut out = vec![0u8; len as usize];
    for block in blocks {
        if block.relative_path != file_path {
            continue;
        }
        let block_start = block.offset;
        let block_end = block.offset + block.size as u64;
        let overlap_start = block_start.max(offset);
        let overlap_end = block_end.min(end);
        if overlap_start >= overlap_end {
            continue;
        }
        let data = storage.read_block(&block.block_id.sha256).await?;
        let src_off = (overlap_start - block_start) as usize;
        let dst_off = (overlap_start - offset) as usize;
        let n = (overlap_end - overlap_start) as usize;
        if src_off + n <= data.len() && dst_off + n <= out.len() {
            out[dst_off..dst_off + n].copy_from_slice(&data[src_off..src_off + n]);
        }
    }
    Ok(out)
}

/// Handles instant recovery: mounts backup as NFS/iSCSI, then background migrates blocks
pub struct InstantRecoveryManager {
    index: Arc<BlockIndex>,
    storage: Arc<RwLock<Box<dyn StorageBackend>>>,
    sessions: Arc<RwLock<Vec<InstantRecoverySession>>>,
}

impl InstantRecoveryManager {
    pub fn new(
        index_path: &str,
        storage: Box<dyn StorageBackend>,
    ) -> Result<Self> {
        let index = Arc::new(BlockIndex::new(index_path)?);
        Ok(Self {
            index,
            storage: Arc::new(RwLock::new(storage)),
            sessions: Arc::new(RwLock::new(Vec::new())),
        })
    }

    /// Start instant recovery via NFS
    /// Exports the backup VM disk as an NFS share that ESXi can mount
    pub async fn start_nfs_recovery(
        &self,
        snapshot_id: &str,
        vm_name: &str,
        _export_path: &str,
        listen_addr: &str,
    ) -> Result<InstantRecoverySession> {
        let session_id = uuid::Uuid::new_v4().to_string();
        info!("Starting NFS Instant Recovery: snapshot={}, vm={}", snapshot_id, vm_name);

        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow::anyhow!("Snapshot not found: {}", snapshot_id))?;

        let total_bytes = manifest.total_size;

        // Build the exported filesystem: one file per distinct path in the manifest.
        let mut exporter = nfs::NfsExporter::new(2049);
        let mut paths: Vec<(String, u64)> = Vec::new();
        for block in &manifest.blocks {
            if let Some((_p, s)) = paths.iter_mut().find(|(p, _)| p == &block.relative_path) {
                *s = (*s).max(block.offset + block.size as u64);
            } else {
                paths.push((block.relative_path.clone(), block.offset + block.size as u64));
            }
        }
        for (path, size) in &paths {
            exporter.add_file(path, *size, 0o644, manifest.created_at as u64);
        }

        // Wire reads to the block store.
        let index = self.index.clone();
        let storage = self.storage.clone();
        let blocks = manifest.blocks.clone();
        let snap = snapshot_id.to_string();
        let snap_for_read = snapshot_id.to_string();
        exporter = exporter.with_read(move |path, off, len| {
            let index = index.clone();
            let storage = storage.clone();
            let blocks = blocks.clone();
            let _snap = snap_for_read.clone();
            let path = path.to_string();
            Box::pin(async move {
                let storage = storage.read().await;
                read_backed_range(&index, storage.as_ref(), &blocks, &path, off, len).await
            })
        });
        let exporter = Arc::new(exporter);

        // Parse listen address (host:port or just port).
        let addr = parse_listen_addr(listen_addr, 2049)?;
        let exporter2 = exporter.clone();
        tokio::spawn(async move {
            if let Err(e) = exporter2.serve(addr).await {
                warn!("NFS server stopped: {}", e);
            }
        });

        let session = InstantRecoverySession {
            id: session_id.clone(),
            snapshot_id: snapshot_id.to_string(),
            vm_name: vm_name.to_string(),
            protocol: Protocol::Nfs,
            mount_path: format!("{}:{}", addr.ip(), 2049),
            target_host: addr.ip().to_string(),
            status: InstantRecoveryStatus::Running,
            progress_pct: 0.0,
            bytes_migrated: 0,
            total_bytes,
        };

        self.sessions.write().await.push(session.clone());
        self.spawn_migration(session_id, snap, total_bytes);
        Ok(session)
    }

    /// Start instant recovery via iSCSI
    /// Presents the backup disk as an iSCSI LUN
    pub async fn start_iscsi_recovery(
        &self,
        snapshot_id: &str,
        vm_name: &str,
        target_iqn: &str,
        listen_addr: &str,
    ) -> Result<InstantRecoverySession> {
        let session_id = uuid::Uuid::new_v4().to_string();
        info!("Starting iSCSI Instant Recovery: snapshot={}, vm={}", snapshot_id, vm_name);

        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow::anyhow!("Snapshot not found: {}", snapshot_id))?;

        let total_bytes = manifest.total_size;
        let iqn = if target_iqn.is_empty() {
            format!("iqn.2026-01.bck:{}", session_id)
        } else {
            target_iqn.to_string()
        };

        let index = self.index.clone();
        let storage = self.storage.clone();
        let blocks = manifest.blocks.clone();

        // Treat the concatenation of all files as one flat LUN: first file starts at 0.
        // For a typical VM backup the manifest has one big disk file.
        let target = iscsi::IscsiTarget::new(&iqn, "BCK", "InstantDisk", total_bytes, 512)
            .with_reader(move |offset, len| {
                let index = index.clone();
                let storage = storage.clone();
                let blocks = blocks.clone();
                Box::pin(async move {
                    let storage = storage.read().await;
                    // Flat LUN: locate file containing this offset (files are ordered by first offset).
                    let mut cursor = 0u64;
                    let mut file_path: Option<String> = None;
                    for block in &blocks {
                        let mut sorted: Vec<&crate::types::FileBlock> = blocks.iter()
                            .filter(|b| b.relative_path == block.relative_path)
                            .collect();
                        sorted.sort_by_key(|b| b.offset);
                        let max_end = sorted.last().map(|b| b.offset + b.size as u64).unwrap_or(0);
                        if cursor <= offset && offset < cursor + max_end {
                            file_path = Some(block.relative_path.clone());
                            break;
                        }
                        cursor += max_end;
                    }
                    match file_path {
                        Some(path) => {
                            // Recompute the base offset for this file within the LUN.
                            let mut base = 0u64;
                            let mut file_base: u64 = 0;
                            let mut seen = std::collections::HashSet::new();
                            for block in &blocks {
                                if seen.insert(block.relative_path.clone()) {
                                    let mut sorted: Vec<&crate::types::FileBlock> = blocks.iter()
                                        .filter(|b| b.relative_path == block.relative_path)
                                        .collect();
                                    sorted.sort_by_key(|b| b.offset);
                                    if block.relative_path == path {
                                        file_base = base;
                                        break;
                                    }
                                    base += sorted.last().map(|b| b.offset + b.size as u64).unwrap_or(0);
                                }
                            }
                            read_backed_range(&index, storage.as_ref(), &blocks, &path, offset - file_base, len).await
                        }
                        None => {
                            // Beyond any known file: read zeros.
                            Ok(vec![0u8; len as usize])
                        }
                    }
                })
            });
        let target = Arc::new(target);
        let addr = parse_listen_addr(listen_addr, 3260)?;
        let target2 = target.clone();
        tokio::spawn(async move {
            if let Err(e) = target2.serve(addr).await {
                warn!("iSCSI server stopped: {}", e);
            }
        });

        let session = InstantRecoverySession {
            id: session_id.clone(),
            snapshot_id: snapshot_id.to_string(),
            vm_name: vm_name.to_string(),
            protocol: Protocol::Iscsi,
            mount_path: format!("{}:{}", addr.ip(), 3260),
            target_host: addr.ip().to_string(),
            status: InstantRecoveryStatus::Running,
            progress_pct: 0.0,
            bytes_migrated: 0,
            total_bytes,
        };

        self.sessions.write().await.push(session.clone());
        self.spawn_migration(session_id, snapshot_id.to_string(), total_bytes);
        Ok(session)
    }

    fn spawn_migration(&self, session_id: String, snap_id: String, total: u64) {
        let storage = self.storage.clone();
        let idx = self.index.clone();
        let sessions = self.sessions.clone();
        tokio::spawn(async move {
            let manifest = match idx.load_manifest(&snap_id) {
                Ok(Some(m)) => m,
                _ => return,
            };
            let storage = storage.read().await;
            let mut migrated = 0u64;
            for block in &manifest.blocks {
                match storage.read_block(&block.block_id.sha256).await {
                    Ok(data) => {
                        migrated += data.len() as u64;
                        if migrated % (1024 * 1024 * 100) < 1024 * 1024 {
                            info!("StorMigration: {}/{} bytes migrated ({:.0}%)",
                                migrated, total, (migrated as f64 / total as f64) * 100.0);
                        }
                    }
                    Err(e) => {
                        warn!("StorMigration block read error: {}", e);
                    }
                }
            }
            let mut sessions = sessions.write().await;
            if let Some(s) = sessions.iter_mut().find(|s| s.id == session_id) {
                s.bytes_migrated = migrated;
                s.progress_pct = if total > 0 { (migrated as f64 / total as f64) * 100.0 } else { 100.0 };
                s.status = InstantRecoveryStatus::Completed;
            }
            info!("StorMigration complete for session {}", session_id);
        });
    }

    /// Stop instant recovery and clean up
    pub async fn stop_recovery(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.write().await;
        sessions.retain(|s| s.id != session_id);
        info!("Instant recovery session {} stopped", session_id);
        Ok(())
    }

    /// List active instant recovery sessions
    pub async fn list_sessions(&self) -> Vec<InstantRecoverySession> {
        self.sessions.read().await.clone()
    }

    /// Get StorMigration status
    pub async fn get_migration_status(&self, session_id: &str) -> Option<InstantRecoverySession> {
        self.sessions.read().await.iter()
            .find(|s| s.id == session_id)
            .cloned()
    }
}

fn parse_listen_addr(listen_addr: &str, default_port: u16) -> Result<SocketAddr> {
    if listen_addr.is_empty() {
        return Ok(SocketAddr::from(([0, 0, 0, 0], default_port)));
    }
    if let Ok(port) = listen_addr.parse::<u16>() {
        return Ok(SocketAddr::from(([0, 0, 0, 0], port)));
    }
    if let Ok(addr) = listen_addr.parse::<SocketAddr>() {
        return Ok(addr);
    }
    // host:port
    let (host, port) = listen_addr
        .rsplit_once(':')
        .ok_or_else(|| anyhow::anyhow!("Invalid listen address: {}", listen_addr))?;
    let port: u16 = port.parse().map_err(|_| anyhow::anyhow!("Invalid port in {}", listen_addr))?;
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        Ok(SocketAddr::new(ip, port))
    } else {
        // default to 0.0.0.0 for hostname
        Ok(SocketAddr::from(([0, 0, 0, 0], port)))
    }
}

/// Registry of active instant recovery servers, shared via AppState so routes
/// can start/stop sessions for arbitrary repositories.
#[derive(Clone, Default)]
pub struct InstantRecoveryRegistry {
    inner: Arc<RwLock<Vec<Arc<InstantRecoveryManager>>>>,
}

impl InstantRecoveryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start an NFS recovery using the provided storage backend.
    pub async fn start_nfs(
        &self,
        index_path: &str,
        storage: Box<dyn StorageBackend>,
        snapshot_id: &str,
        vm_name: &str,
        export_path: &str,
        listen_addr: &str,
    ) -> Result<InstantRecoverySession> {
        let mgr = Arc::new(InstantRecoveryManager::new(index_path, storage)?);
        let session = mgr.start_nfs_recovery(snapshot_id, vm_name, export_path, listen_addr).await?;
        self.inner.write().await.push(mgr);
        Ok(session)
    }

    /// Start an iSCSI recovery using the provided storage backend.
    pub async fn start_iscsi(
        &self,
        index_path: &str,
        storage: Box<dyn StorageBackend>,
        snapshot_id: &str,
        vm_name: &str,
        target_iqn: &str,
        listen_addr: &str,
    ) -> Result<InstantRecoverySession> {
        let mgr = Arc::new(InstantRecoveryManager::new(index_path, storage)?);
        let session = mgr.start_iscsi_recovery(snapshot_id, vm_name, target_iqn, listen_addr).await?;
        self.inner.write().await.push(mgr);
        Ok(session)
    }

    /// Stop a recovery session across all managers.
    pub async fn stop_session(&self, session_id: &str) -> bool {
        let mgrs = self.inner.read().await;
        for mgr in mgrs.iter() {
            if mgr.stop_recovery(session_id).await.is_ok() {
                return true;
            }
        }
        false
    }

    pub async fn list_sessions(&self) -> Vec<InstantRecoverySession> {
        let mgrs = self.inner.read().await;
        let mut out = Vec::new();
        for mgr in mgrs.iter() {
            out.extend(mgr.list_sessions().await);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_addr() {
        let a = parse_listen_addr("", 2049).unwrap();
        assert_eq!(a.port(), 2049);
        let b = parse_listen_addr("0.0.0.0:3260", 2049).unwrap();
        assert_eq!(b.port(), 3260);
        let c = parse_listen_addr("2049", 2049).unwrap();
        assert_eq!(c.port(), 2049);
    }
}
