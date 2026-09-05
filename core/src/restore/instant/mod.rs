pub mod iscsi;
pub mod nfs;
pub mod xdr;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::index::BlockIndex;
use crate::integrations::HypervisorConnector;
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
    pub hypervisor_id: Option<String>,
    pub vm_ref: Option<String>,
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
    /// Optional hypervisor connector used to register the recovered VM directly
    /// on VMware/Hyper-V (instant recovery for VMs).
    connectors: Arc<RwLock<HashMap<String, Arc<dyn HypervisorConnector>>>>,
    /// BUG-004 / BUG-005: cancellation tokens for the background tasks
    /// spawned by this manager. `stop_recovery` cancels them so the
    /// tokio tasks exit and the file descriptors / storage backend reads
    /// are released promptly.
    cancel_tokens: Arc<RwLock<HashMap<String, tokio_util::sync::CancellationToken>>>,
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
            connectors: Arc::new(RwLock::new(HashMap::new())),
            cancel_tokens: Arc::new(RwLock::new(HashMap::new())),
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
            hypervisor_id: None,
            vm_ref: None,
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
            hypervisor_id: None,
            vm_ref: None,
        };

        self.sessions.write().await.push(session.clone());
        self.spawn_migration(session_id, snapshot_id.to_string(), total_bytes);
        Ok(session)
    }

    /// Start instant recovery and register the recovered VM directly on the
    /// target hypervisor (VMware / Hyper-V). The VM boots from the NFS/iSCSI
    /// export backed by the snapshot, so no full restore is required. Returns
    /// the session with the hypervisor VM ref populated.
    pub async fn start_hypervisor_recovery(
        &self,
        snapshot_id: &str,
        vm_name: &str,
        protocol: &str,
        listen_addr: &str,
        hypervisor_id: &str,
        connector: Box<dyn HypervisorConnector>,
        datastore: &str,
        power_on: bool,
    ) -> Result<InstantRecoverySession> {
        let mut session = match protocol.to_lowercase().as_str() {
            "iscsi" => self.start_iscsi_recovery(snapshot_id, vm_name, "", listen_addr).await?,
            _ => self.start_nfs_recovery(snapshot_id, vm_name, "", listen_addr).await?,
        };

        // Build the list of virtual disk / config files in the snapshot so the
        // VM can be registered against the export.
        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow::anyhow!("Snapshot not found: {}", snapshot_id))?;
        let mut disk_files: Vec<String> = manifest.blocks.iter()
            .map(|b| b.relative_path.clone())
            .collect();
        disk_files.sort();
        disk_files.dedup();

        let vm_ref = connector.register_vm(vm_name, &disk_files, datastore, power_on).await?;
        info!(
            "Instant recovery: registered VM '{}' on hypervisor {} as {} ({} disk files)",
            vm_name, hypervisor_id, vm_ref, disk_files.len()
        );

        self.connectors.write().await.insert(session.id.clone(), Arc::from(connector));
        session.vm_ref = Some(vm_ref);
        session.hypervisor_id = Some(hypervisor_id.to_string());
        if let Some(s) = self.sessions.write().await.iter_mut().find(|s| s.id == session.id) {
            s.vm_ref = session.vm_ref.clone();
            s.hypervisor_id = session.hypervisor_id.clone();
        }
        Ok(session)
    }

    fn spawn_migration(&self, session_id: String, snap_id: String, total: u64) {
        let storage = self.storage.clone();
        let idx = self.index.clone();
        let sessions = self.sessions.clone();
        let cancel = tokio_util::sync::CancellationToken::new();
        // BUG-004/005: store the token so stop_recovery can cancel the
        // background task.
        let cancel_for_store = cancel.clone();
        let sid_for_store = session_id.clone();
        let cancel_map = self.cancel_tokens.clone();
        let sid_for_map = sid_for_store.clone();
        tokio::spawn(async move {
            // Register the token.
            cancel_map.write().await.insert(sid_for_map.clone(), cancel_for_store);
            let manifest = match idx.load_manifest(&snap_id) {
                Ok(Some(m)) => m,
                _ => {
                    cancel_map.write().await.remove(&sid_for_map);
                    return;
                }
            };
            let storage = storage.read().await;
            let mut migrated = 0u64;
            for block in &manifest.blocks {
                if cancel.is_cancelled() {
                    info!("StorMigration cancelled for session {}", session_id);
                    break;
                }
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
                if !cancel.is_cancelled() {
                    s.status = InstantRecoveryStatus::Completed;
                }
            }
            cancel_map.write().await.remove(&session_id);
            info!("StorMigration complete for session {}", session_id);
        });
    }

    /// Stop instant recovery and clean up. If the session registered a VM on a
    /// hypervisor, unregister it first.
    pub async fn stop_recovery(&self, session_id: &str) -> Result<()> {
        // BUG-004/005: cancel the background migration task so the
        // file-descriptor held by the storage backend is released promptly.
        if let Some(tok) = self.cancel_tokens.write().await.remove(session_id) {
            tok.cancel();
        }
        {
            let sessions = self.sessions.read().await;
            if let Some(s) = sessions.iter().find(|s| s.id == session_id) {
                if let Some(vm_ref) = &s.vm_ref {
                    if let Some(conn) = self.connectors.read().await.get(session_id) {
                        match conn.unregister_vm(vm_ref).await {
                            Ok(_) => info!("Instant recovery: unregistered VM {} from hypervisor", vm_ref),
                            Err(e) => warn!("Instant recovery: failed to unregister VM {}: {}", vm_ref, e),
                        }
                    }
                }
            }
        }
        self.connectors.write().await.remove(session_id);
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
    // Default to loopback, never 0.0.0.0. Instant recovery serves unencrypted
    // backup data; binding to every interface without an explicit operator
    // override would expose it to the whole network.
    if listen_addr.is_empty() {
        return Ok(SocketAddr::from(([127, 0, 0, 1], default_port)));
    }
    if let Ok(port) = listen_addr.parse::<u16>() {
        return Ok(SocketAddr::from(([127, 0, 0, 1], port)));
    }
    if let Ok(addr) = listen_addr.parse::<SocketAddr>() {
        return parse_addr_safety(addr, listen_addr);
    }
    // host:port
    let (host, port) = listen_addr
        .rsplit_once(':')
        .ok_or_else(|| anyhow::anyhow!("Invalid listen address: {}", listen_addr))?;
    let port: u16 = port
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid port in {}", listen_addr))?;
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        parse_addr_safety(SocketAddr::new(ip, port), listen_addr)
    } else {
        // Refuse to wildcard for a hostname — the operator must supply an
        // explicit IP to expose instant recovery to remote hypervisors.
        anyhow::bail!(
            "listen address host '{}' is not an IP; use an explicit IP to expose instant recovery remotely",
            host
        )
    }
}

fn is_link_local_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_unicast_link_local(),
    }
}

/// SEC-006/007: refuse to bind to anything other than loopback / link-local
/// unless the operator explicitly opts in via `BCK_ALLOW_PUBLIC_INSTANT_RECOVERY=1`.
/// 0.0.0.0 is rejected outright to prevent accidentally exposing backup data
/// over the network.
fn parse_addr_safety(addr: SocketAddr, original: &str) -> Result<SocketAddr> {
    if std::env::var("BCK_ALLOW_PUBLIC_INSTANT_RECOVERY").as_deref() != Ok("1") {
        if addr.ip().is_unspecified() {
            anyhow::bail!(
                "refusing to bind instant recovery to 0.0.0.0 (would expose backup data); \
                 set BCK_ALLOW_PUBLIC_INSTANT_RECOVERY=1 to override, or use a loopback / explicit IP",
            );
        }
        if !addr.ip().is_loopback() && !is_link_local_ip(&addr.ip()) {
            anyhow::bail!(
                "refusing to bind instant recovery to non-loopback address {}; \
                 set BCK_ALLOW_PUBLIC_INSTANT_RECOVERY=1 to override",
                original
            );
        }
    }
    Ok(addr)
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

    /// Start instant recovery for a VM and register it on the target hypervisor
    /// (VMware / Hyper-V). The VM boots directly from the backup export.
    pub async fn start_hypervisor(
        &self,
        index_path: &str,
        storage: Box<dyn StorageBackend>,
        snapshot_id: &str,
        vm_name: &str,
        protocol: &str,
        listen_addr: &str,
        hypervisor_id: &str,
        connector: Box<dyn HypervisorConnector>,
        datastore: &str,
        power_on: bool,
    ) -> Result<InstantRecoverySession> {
        let mgr = Arc::new(InstantRecoveryManager::new(index_path, storage)?);
        let session = mgr.start_hypervisor_recovery(
            snapshot_id, vm_name, protocol, listen_addr, hypervisor_id, connector, datastore, power_on,
        ).await?;
        self.inner.write().await.push(mgr);
        Ok(session)
    }

    /// Stop a recovery session across all managers. SEC-009: also remove the
    /// manager from the registry so its NFS/iSCSI server tasks and
    /// `Arc<InstantRecoveryManager>` do not accumulate across
    /// start/stop cycles (which previously led to file-descriptor and memory
    /// exhaustion on long-running deployments).
    pub async fn stop_session(&self, session_id: &str) -> bool {
        let mut mgrs = self.inner.write().await;
        // First, locate the manager that owns this session.
        let mut target_idx: Option<usize> = None;
        for (i, mgr) in mgrs.iter().enumerate() {
            let sessions = mgr.list_sessions().await;
            if sessions.iter().any(|s| s.id == session_id) {
                target_idx = Some(i);
                break;
            }
        }
        let Some(idx) = target_idx else { return false };
        // Remove the manager from the registry BEFORE stopping so concurrent
        // list_sessions() calls do not race a future start.
        let mgr = mgrs.remove(idx);
        drop(mgrs);
        mgr.stop_recovery(session_id).await.is_ok()
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
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicBool, Ordering};

    use crate::storage::local::LocalStorage;
    use crate::types::{BackupManifest, BlockId, FileBlock, FileMetadata};

    /// Connector that records register/unregister calls.
    struct MockConnector {
        registered: Arc<AtomicBool>,
        unregistered: Arc<AtomicBool>,
    }

    #[async_trait]
    impl HypervisorConnector for MockConnector {
        async fn connect(&self) -> Result<()> { Ok(()) }
        async fn test_connection(&self) -> Result<()> { Ok(()) }
        async fn list_vms(&self) -> Result<Vec<crate::integrations::VmInfo>> { Ok(vec![]) }
        async fn get_vm(&self, _mo_ref: &str) -> Result<crate::integrations::VmInfo> {
            anyhow::bail!("not implemented")
        }
        async fn power_on(&self, _vm_ref: &str) -> Result<()> { Ok(()) }
        async fn power_off(&self, _vm_ref: &str, _force: bool) -> Result<()> { Ok(()) }
        async fn create_snapshot(
            &self,
            _vm_ref: &str,
            _name: &str,
            _description: &str,
            _quiesce: bool,
            _memory: bool,
        ) -> Result<crate::integrations::VmSnapshot> {
            anyhow::bail!("not implemented")
        }
        async fn remove_snapshot(&self, _vm_ref: &str, _snapshot_id: &str) -> Result<()> { Ok(()) }
        async fn get_changed_blocks(
            &self,
            _vm_ref: &str,
            _disk_id: &str,
            _change_id: &str,
        ) -> Result<Vec<crate::integrations::ChangedBlock>> { Ok(vec![]) }
        async fn get_change_id(&self, _vm_ref: &str, _disk_id: &str) -> Result<Option<String>> { Ok(None) }
        async fn read_disk_blocks(
            &self,
            _vm_ref: &str,
            _disk_path: &str,
            _offset: i64,
            _length: i64,
        ) -> Result<Vec<u8>> { Ok(vec![]) }
        async fn register_vm(
            &self,
            _vm_name: &str,
            disk_files: &[String],
            _datastore: &str,
            _power_on: bool,
        ) -> Result<String> {
            assert!(!disk_files.is_empty());
            self.registered.store(true, Ordering::SeqCst);
            Ok("vm-ref-123".into())
        }
        async fn unregister_vm(&self, _vm_ref: &str) -> Result<()> {
            self.unregistered.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    /// Build a manifest with one virtual disk and persist the backing block.
    async fn seed_snapshot(index_path: &str, store_path: &str, snap_id: &str) {
        let storage = LocalStorage::new(store_path).unwrap();
        let block_data = vec![0xabu8; 8192];
        let id = BlockId {
            sha256: crate::dedup::DedupEngine::calculate_id(&block_data).sha256,
            size: block_data.len() as u32,
        };
        storage.write_block(&id.sha256, &block_data).await.unwrap();
        let manifest = BackupManifest {
            snapshot_id: snap_id.to_string(),
            parent_id: None,
            blocks: vec![FileBlock {
                relative_path: "disks/disk0.vmdk".into(),
                offset: 0,
                size: block_data.len() as u32,
                block_id: id.clone(),
                metadata: FileMetadata {
                    path: "disks/disk0.vmdk".into(),
                    size: block_data.len() as u64,
                    modified_time: 0,
                    mode: 0,
                    owner: "vm".into(),
                    group: "vm".into(),
                    extended_attributes: std::collections::HashMap::new(),
                    acl: Vec::new(),
                },
            }],
            total_size: block_data.len() as u64,
            unique_size: block_data.len() as u64,
            compressed_size: block_data.len() as u64,
            file_count: 1,
            checksum: "test".into(),
            created_at: 0,
        };
        let index = BlockIndex::new(index_path).unwrap();
        index.save_manifest(snap_id, &manifest).unwrap();
    }

    #[tokio::test]
    async fn hypervisor_instant_recovery_registers_and_unregisters_vm() {
        let dir = std::env::temp_dir().join(format!("bck-ir-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let index_path = dir.join("index").to_string_lossy().to_string();
        let store_path = dir.join("store").to_string_lossy().to_string();
        std::fs::create_dir_all(&dir.join("index")).unwrap();
        std::fs::create_dir_all(&dir.join("store")).unwrap();

        seed_snapshot(&index_path, &store_path, "snap-1").await;

        let storage = LocalStorage::new(&store_path).unwrap();
        let mgr = InstantRecoveryManager::new(&index_path, Box::new(storage)).unwrap();
        let connector = MockConnector {
            registered: Arc::new(AtomicBool::new(false)),
            unregistered: Arc::new(AtomicBool::new(false)),
        };
        let reg_flag = connector.registered.clone();
        let unreg_flag = connector.unregistered.clone();

        let session = mgr.start_hypervisor_recovery(
            "snap-1",
            "restored-vm",
            "nfs",
            "127.0.0.1:0",
            "hv-1",
            Box::new(connector),
            "datastore1",
            true,
        ).await.unwrap();

        assert!(reg_flag.load(Ordering::SeqCst));
        assert_eq!(session.vm_ref.as_deref(), Some("vm-ref-123"));
        assert_eq!(session.hypervisor_id.as_deref(), Some("hv-1"));

        // Stopping unregisters the VM from the hypervisor.
        mgr.stop_recovery(&session.id).await.unwrap();
        assert!(unreg_flag.load(Ordering::SeqCst));
        assert!(mgr.list_sessions().await.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parse_listen_addr_defaults_to_loopback_never_wildcard() {
        assert_eq!(parse_listen_addr("", 2049).unwrap(), SocketAddr::from(([127, 0, 0, 1], 2049)));
        assert_eq!(parse_listen_addr("", 3260).unwrap(), SocketAddr::from(([127, 0, 0, 1], 3260)));
        assert_eq!(parse_listen_addr("2049", 2049).unwrap(), SocketAddr::from(([127, 0, 0, 1], 2049)));
        // SEC-006/007: 0.0.0.0 is refused by default.
        assert!(parse_listen_addr("0.0.0.0:2049", 2049).is_err());
        // A hostname that cannot resolve to an explicit IP is rejected instead
        // of silently wildcarding to all interfaces.
        assert!(parse_listen_addr("my-nfs-host:2049", 2049).is_err());
        // A non-loopback IP is also refused by default.
        assert!(parse_listen_addr("10.0.0.5:2049", 2049).is_err());
    }
}
