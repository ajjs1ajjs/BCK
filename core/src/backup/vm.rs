use anyhow::{Result, anyhow};
use tracing::{info, warn};

use crate::backup::VmBackupResult;
use crate::integrations::HypervisorConnector;
use crate::pipeline::BackupPipeline;
use crate::storage::StorageBackend;
use crate::types::{BackupStats, CompressionAlgorithm, EncryptionAlgorithm, PipelineConfig};

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
        pipeline: &BackupPipeline,
        storage: &dyn StorageBackend,
    ) -> Result<VmBackupResult> {
        // 1. Get VM info
        let vm = self.connector.get_vm(self.vm_ref).await?;
        info!("Starting VM backup: {} (ref: {})", vm.name, self.vm_ref);

        // 2. Discover disks and check CBT
        let mut total_disks = 0usize;
        let mut changed_disks = 0usize;

        for disk in &vm.disks {
            total_disks += 1;

            // Check if CBT is enabled
            let change_id = self.connector.get_change_id(self.vm_ref, &disk.disk_id).await?;
            if change_id.is_some() {
                changed_disks += 1;
                info!("  Disk {}: CBT enabled, change_id: {:?}", disk.label, change_id);
            } else {
                warn!("  Disk {}: CBT not enabled, will do full backup", disk.label);
            }
        }

        // 3. Create VM snapshot
        let snapshot_name = format!("BCK-{}", chrono::Utc::now().format("%Y%m%d-%H%M%S"));
        let snapshot = self.connector.create_snapshot(
            self.vm_ref,
            &snapshot_name,
            "BCK Enterprise Backup Snapshot",
            true,  // quiesce (VSS)
            false, // don't snapshot memory
        ).await?;

        info!("Snapshot created: {} (id: {})", snapshot_name, snapshot.id);

        // 4. Process each disk
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

        for disk in &vm.disks {
            let change_id = self.connector.get_change_id(self.vm_ref, &disk.disk_id).await?;

            let changed_blocks = if let Some(ref cid) = change_id {
                self.connector.get_changed_blocks(self.vm_ref, &disk.disk_id, cid).await?
            } else {
                Vec::new()
            };

            if changed_blocks.is_empty() && change_id.is_some() {
                info!("  Disk {}: no changes, skipping", disk.label);
                continue;
            }

            info!(
                "  Processing disk {}: {} changed blocks, capacity: {} GB",
                disk.label,
                changed_blocks.len(),
                disk.capacity_bytes / 1073741824
            );

            stats.total_bytes += disk.capacity_bytes as u64;
        }

        // 5. Clean up snapshot
        self.connector.remove_snapshot(self.vm_ref, &snapshot.id).await?;
        info!("Snapshot removed: {}", snapshot.id);

        Ok(VmBackupResult {
            vm_name: vm.name,
            snapshot_id: snapshot.id,
            stats,
            total_disks,
            changed_disks,
        })
    }
}
