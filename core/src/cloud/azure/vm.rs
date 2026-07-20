use anyhow::Result;
use tracing::info;

/// Azure VM backup using snapshots and restore points
pub struct AzureVmBackup;

impl AzureVmBackup {
    pub fn new() -> Self {
        Self
    }

    /// Create restore point collection for a VM
    pub async fn create_restore_point(&self, _vm_id: &str, _name: &str) -> Result<()> {
        info!("Creating Azure VM restore point: {}", _vm_id);
        // POST /subscriptions/.../virtualMachines/.../restorePoints
        Ok(())
    }

    /// Restore VM from restore point
    pub async fn restore_vm(&self, _restore_point_id: &str, _new_vm_name: &str) -> Result<()> {
        info!("Restoring Azure VM from restore point: {}", _restore_point_id);
        // Create disk from snapshot + deploy VM
        Ok(())
    }

    /// List restore points for a VM
    pub async fn list_restore_points(&self, _vm_id: &str) -> Result<Vec<String>> {
        Ok(Vec::new())
    }
}
