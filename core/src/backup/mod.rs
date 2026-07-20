pub mod vm;

use crate::integrations::HypervisorConnector;
use crate::pipeline::BackupPipeline;
use crate::storage::StorageBackend;
use crate::types::BackupStats;

pub struct BackupOrchestrator {
    pipeline: BackupPipeline,
}

impl BackupOrchestrator {
    pub fn new(pipeline: BackupPipeline) -> Self {
        Self { pipeline }
    }

    pub async fn run_vm_backup(
        &self,
        connector: &dyn HypervisorConnector,
        vm_ref: &str,
        storage: &dyn StorageBackend,
    ) -> Result<VmBackupResult, anyhow::Error> {
        let result = vm::VmBackupJob::new(connector, vm_ref)
            .run(&self.pipeline, storage)
            .await?;
        Ok(result)
    }
}

#[derive(Debug)]
pub struct VmBackupResult {
    pub vm_name: String,
    pub snapshot_id: String,
    pub stats: BackupStats,
    pub total_disks: usize,
    pub changed_disks: usize,
}
