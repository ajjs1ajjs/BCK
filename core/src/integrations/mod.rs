pub mod vmware;
pub mod hyperv;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HypervisorInfo {
    pub id: String,
    pub name: String,
    pub hv_type: String,
    pub host: String,
    pub port: u16,
    pub version: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmInfo {
    pub id: String,
    pub name: String,
    pub hypervisor_id: String,
    pub mo_ref: String,
    pub power_state: PowerState,
    pub os: Option<String>,
    pub cpu_count: i32,
    pub ram_mb: i64,
    pub disks: Vec<VmDiskInfo>,
    pub networks: Vec<VmNetworkInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmDiskInfo {
    pub disk_id: String,
    pub label: String,
    pub capacity_bytes: i64,
    pub disk_path: String,
    pub datastore: String,
    pub change_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmNetworkInfo {
    pub label: String,
    pub network_name: Option<String>,
    pub mac_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PowerState {
    PoweredOn,
    PoweredOff,
    Suspended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmSnapshot {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub state: PowerState,
    pub quiesced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedBlock {
    pub offset: i64,
    pub length: i64,
}

#[async_trait]
pub trait HypervisorConnector: Send + Sync {
    /// Connect to the hypervisor
    async fn connect(&self) -> Result<(), anyhow::Error>;

    /// Test connectivity
    async fn test_connection(&self) -> Result<(), anyhow::Error>;

    /// List all VMs
    async fn list_vms(&self) -> Result<Vec<VmInfo>, anyhow::Error>;

    /// Get VM by reference
    async fn get_vm(&self, mo_ref: &str) -> Result<VmInfo, anyhow::Error>;

    /// Create a VM snapshot
    async fn create_snapshot(
        &self,
        vm_ref: &str,
        name: &str,
        description: &str,
        quiesce: bool,
        memory: bool,
    ) -> Result<VmSnapshot, anyhow::Error>;

    /// Remove a VM snapshot
    async fn remove_snapshot(&self, vm_ref: &str, snapshot_id: &str) -> Result<(), anyhow::Error>;

    /// Get changed blocks since last snapshot (CBT)
    async fn get_changed_blocks(
        &self,
        vm_ref: &str,
        disk_id: &str,
        change_id: &str,
    ) -> Result<Vec<ChangedBlock>, anyhow::Error>;

    /// Get the current change ID for a disk
    async fn get_change_id(&self, vm_ref: &str, disk_id: &str) -> Result<Option<String>, anyhow::Error>;

    /// Read disk data at specific offset
    async fn read_disk_blocks(
        &self,
        vm_ref: &str,
        disk_path: &str,
        offset: i64,
        length: i64,
    ) -> Result<Vec<u8>, anyhow::Error>;
}
