use anyhow::Result;
use tracing::{info, warn};

use crate::backup::VmBackupResult;
use crate::integrations::{ChangedBlock, HypervisorConnector};
use crate::pipeline::BackupPipeline;
use crate::storage::StorageBackend;
use crate::types::{BackupStats, FileBlock};

/// Read up to 8 MiB per hypervisor read request to keep memory bounded.
const READ_CHUNK: i64 = 8 * 1024 * 1024;

pub struct VmBackupJob<'a> {
    connector: &'a dyn HypervisorConnector,
    vm_ref: &'a str,
}

impl<'a> VmBackupJob<'a> {
    pub fn new(connector: &'a dyn HypervisorConnector, vm_ref: &'a str) -> Self {
        Self { connector, vm_ref }
    }

    pub async fn run(
        &self,
        pipeline: &mut BackupPipeline,
        storage: &dyn StorageBackend,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<VmBackupResult> {
        // 1. Get VM info
        let vm = self.connector.get_vm(self.vm_ref).await?;
        info!("Starting VM backup: {} (ref: {})", vm.name, self.vm_ref);

        // 2. Create a crash-consistent (quiesced if supported) snapshot
        let snapshot_name = format!("BCK-{}", chrono::Utc::now().format("%Y%m%d-%H%M%S"));
        let snapshot = self.connector.create_snapshot(
            self.vm_ref,
            &snapshot_name,
            "BCK Enterprise Backup Snapshot",
            true,  // quiesce (VSS)
            false, // don't snapshot memory
        ).await?;
        info!("Snapshot created: {} (id: {})", snapshot_name, snapshot.id);

        // 3. Process each disk through the pipeline
        let mut stats = BackupStats {
            total_bytes: 0,
            unique_bytes: 0,
            compressed_bytes: 0,
            transferred_bytes: 0,
            files_processed: 0,
            blocks_deduped: 0,
            blocks_unique: 0,
            speed_bps: 0,
            dedup_ratio: 1.0,
            compression_ratio: 1.0,
            elapsed_seconds: 0,
        };

        let mut all_blocks: Vec<FileBlock> = Vec::new();
        let mut total_disks = 0usize;
        let mut changed_disks = 0usize;

        let disk_result: Result<()> = async {
            for disk in &vm.disks {
                if cancel.is_cancelled() {
                    return Err(anyhow::anyhow!("VM backup cancelled"));
                }
                total_disks += 1;

                // Determine which byte ranges to read: CBT changed blocks when the
                // hypervisor exposes a change id, otherwise the whole disk.
                let change_id = self.connector.get_change_id(self.vm_ref, &disk.disk_id).await?;
                let ranges = if let Some(cid) = &change_id {
                    let changed = self.connector.get_changed_blocks(self.vm_ref, &disk.disk_id, cid).await?;
                    if changed.is_empty() {
                        info!("  Disk {}: CBT enabled, no changes, skipping", disk.label);
                    } else {
                        changed_disks += 1;
                    }
                    changed
                } else {
                    warn!("  Disk {}: CBT not enabled, will do full backup", disk.label);
                    vec![ChangedBlock { offset: 0, length: disk.capacity_bytes }]
                };

                let logical_path = format!("disks/{}", disk.label);

                for range in ranges {
                    let mut offset = range.offset;
                    let end = range.offset + range.length;
                    while offset < end {
                        let len = READ_CHUNK.min(end - offset);
                        let data = self.connector.read_disk_blocks(self.vm_ref, &disk.disk_path, offset, len).await?;
                        stats.total_bytes += data.len() as u64;
                        let blocks = pipeline.process_bytes(
                            &logical_path,
                            offset as u64,
                            disk.capacity_bytes as u64,
                            &data,
                            storage,
                            &mut stats,
                        ).await?;
                        all_blocks.extend(blocks);
                        offset += len;
                    }
                }
                stats.files_processed += 1;
            }
            Ok(())
        }.await;

        // 4. Always try to remove the hypervisor snapshot, even on error or
        //    cancellation — otherwise the snapshot leaks on the hypervisor.
        let removal = self.connector.remove_snapshot(self.vm_ref, &snapshot.id).await;
        if let Err(e) = disk_result {
            warn!("VM backup failed; removed snapshot {}: {:?}", snapshot.id, removal.err());
            return Err(e);
        }
        removal?;
        info!("Snapshot removed: {}", snapshot.id);

        stats.dedup_ratio = if stats.blocks_unique > 0 {
            (stats.blocks_deduped as f64 + stats.blocks_unique as f64) / stats.blocks_unique as f64
        } else {
            1.0
        };
        stats.compression_ratio = if stats.compressed_bytes > 0 {
            stats.total_bytes as f64 / stats.compressed_bytes as f64
        } else {
            1.0
        };

        Ok(VmBackupResult {
            vm_name: vm.name,
            snapshot_id: snapshot.id,
            stats,
            blocks: all_blocks,
            total_disks,
            changed_disks,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use crate::integrations::{
        ChangedBlock, PowerState, VmDiskInfo, VmInfo, VmNetworkInfo, VmSnapshot,
    };
    use crate::pipeline::BackupPipeline;
    use crate::storage::local::LocalStorage;
    use crate::types::{ChunkSizeConfig, CompressionAlgorithm, EncryptionAlgorithm, PipelineConfig};

    /// In-memory connector that exposes a single disk with deterministic data.
    struct MockConnector {
        disk: VmDiskInfo,
        data: Vec<u8>,
        snapshot_created: Arc<AtomicBool>,
        snapshot_removed: Arc<AtomicBool>,
    }

    #[async_trait]
    impl HypervisorConnector for MockConnector {
        async fn connect(&self) -> Result<()> { Ok(()) }
        async fn test_connection(&self) -> Result<()> { Ok(()) }

        async fn list_vms(&self) -> Result<Vec<VmInfo>> {
            Ok(vec![self.get_vm("vm-1").await?])
        }

        async fn get_vm(&self, _mo_ref: &str) -> Result<VmInfo> {
            Ok(VmInfo {
                id: "vm-1".into(),
                name: "test-vm".into(),
                hypervisor_id: "hv-1".into(),
                mo_ref: "vm-1".into(),
                power_state: PowerState::PoweredOn,
                os: Some("linux".into()),
                cpu_count: 2,
                ram_mb: 4096,
                disks: vec![self.disk.clone()],
                networks: vec![VmNetworkInfo {
                    label: "nic0".into(),
                    network_name: None,
                    mac_address: None,
                }],
            })
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
        ) -> Result<VmSnapshot> {
            self.snapshot_created.store(true, Ordering::SeqCst);
            Ok(VmSnapshot {
                id: "snap-1".into(),
                name: Some("BCK-test".into()),
                description: None,
                created_at: 0,
                state: PowerState::PoweredOn,
                quiesced: false,
            })
        }

        async fn remove_snapshot(&self, _vm_ref: &str, _snapshot_id: &str) -> Result<()> {
            self.snapshot_removed.store(true, Ordering::SeqCst);
            Ok(())
        }

        async fn get_changed_blocks(
            &self,
            _vm_ref: &str,
            _disk_id: &str,
            _change_id: &str,
        ) -> Result<Vec<ChangedBlock>> {
            Ok(vec![])
        }

        async fn get_change_id(&self, _vm_ref: &str, _disk_id: &str) -> Result<Option<String>> {
            Ok(None) // no CBT -> full backup
        }

        async fn read_disk_blocks(
            &self,
            _vm_ref: &str,
            _disk_path: &str,
            offset: i64,
            length: i64,
        ) -> Result<Vec<u8>> {
            let start = offset as usize;
            let end = (start + length as usize).min(self.data.len());
            Ok(self.data[start..end].to_vec())
        }

        async fn register_vm(
            &self,
            _vm_name: &str,
            _disk_files: &[String],
            _datastore: &str,
            _power_on: bool,
        ) -> Result<String> {
            Ok("restored-1".into())
        }

        async fn unregister_vm(&self, _vm_ref: &str) -> Result<()> { Ok(()) }
    }

    #[tokio::test]
    async fn vm_backup_streams_disks_to_storage() {
        let dir = std::env::temp_dir().join(format!("bck-vmbackup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        // Deterministic 1 MiB disk payload (repeating pattern so dedup/compression is exercised).
        let pattern: Vec<u8> = (0..512u32).map(|i| (i % 251) as u8).collect();
        let mut data = Vec::with_capacity(1024 * 1024);
        while data.len() < 1024 * 1024 {
            data.extend_from_slice(&pattern);
        }

        let disk = VmDiskInfo {
            disk_id: "disk-1000".into(),
            label: "disk0".into(),
            capacity_bytes: data.len() as i64,
            disk_path: "[datastore1] test-vm/test-vm.vmdk".into(),
            datastore: "datastore1".into(),
            change_id: None,
        };

        let connector = MockConnector {
            disk,
            data,
            snapshot_created: Arc::new(AtomicBool::new(false)),
            snapshot_removed: Arc::new(AtomicBool::new(false)),
        };

        let pipeline_config = PipelineConfig {
            compression: CompressionAlgorithm::Zstd { level: 1 },
            encryption: EncryptionAlgorithm::None,
            encryption_key: None,
            chunk_size: ChunkSizeConfig::default(),
            throttle: None,
        };
        let mut pipeline = BackupPipeline::new(pipeline_config);
        let index_dir = dir.join("index");
        std::fs::create_dir_all(&index_dir).unwrap();
        pipeline = pipeline.with_dedup(&index_dir.to_string_lossy()).unwrap();

        let store_dir = dir.join("store");
        let storage = LocalStorage::new(&store_dir.to_string_lossy()).unwrap();

        let job = VmBackupJob::new(&connector, "vm-1");
        let cancel = tokio_util::sync::CancellationToken::new();
        let result = job.run(&mut pipeline, &storage, cancel).await.unwrap();

        assert_eq!(result.vm_name, "test-vm");
        assert_eq!(result.total_disks, 1);
        assert_eq!(result.changed_disks, 0);
        assert_eq!(result.stats.total_bytes, 1024 * 1024);
        assert!(result.stats.blocks_unique > 0);
        assert!(!result.blocks.is_empty());
        assert!(connector.snapshot_created.load(Ordering::SeqCst));
        assert!(connector.snapshot_removed.load(Ordering::SeqCst));

        // Blocks were actually written to storage (LocalStorage nests them in
        // subdirectories, so use recursive stats).
        let st = storage.stats().await.unwrap();
        assert!(st.total_blocks > 0);

        // The manifest blocks cover the full disk (offset 0 .. 1 MiB).
        let max_end = result.blocks.iter().map(|b| b.offset + b.size as u64).max().unwrap();
        assert!(max_end >= 1024 * 1024);

        std::fs::remove_dir_all(&dir).ok();
    }
}
