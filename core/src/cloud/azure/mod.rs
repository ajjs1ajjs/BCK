pub mod vm;
pub mod disks;
pub mod sql;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::CloudAccount;

/// Azure connector — manages Azure VM, Disk, and SQL backups
pub struct AzureConnector {
    account: CloudAccount,
}

impl AzureConnector {
    pub fn new(account: CloudAccount) -> Self {
        Self { account }
    }

    /// Authenticate with Azure using SPN or managed identity
    pub async fn authenticate(&self) -> Result<AzureSession> {
        info!("Authenticating with Azure: region={}", self.account.region);
        Ok(AzureSession {
            subscription_id: String::new(),
            region: self.account.region.clone(),
        })
    }

    /// List all Azure VMs
    pub async fn list_vms(&self) -> Result<Vec<AzureVm>> {
        // GET /subscriptions/{id}/providers/Microsoft.Compute/virtualMachines
        Ok(Vec::new())
    }
}

pub struct AzureSession {
    pub subscription_id: String,
    pub region: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureVm {
    pub id: String,
    pub name: String,
    pub resource_group: String,
    pub vm_size: String,
    pub os_type: String,
    pub disks: Vec<AzureDisk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AzureDisk {
    pub id: String,
    pub name: String,
    pub size_gb: u64,
    pub sku: String,
    pub lun: u32,
}
