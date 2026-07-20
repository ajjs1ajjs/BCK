use anyhow::{Result, anyhow};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::integrations::{
    ChangedBlock, HypervisorConnector, HypervisorInfo, PowerState,
    VmDiskInfo, VmInfo, VmNetworkInfo, VmSnapshot,
};

/// Hyper-V connector using WinRM / PowerShell
pub struct HyperVConnector {
    host: String,
    username: String,
    password: String,
    use_ssl: bool,
}

impl HyperVConnector {
    pub fn new(host: &str, username: &str, password: &str, use_ssl: bool) -> Self {
        Self {
            host: host.to_string(),
            username: username.to_string(),
            password: password.to_string(),
            use_ssl,
        }
    }

    async fn run_powershell(&self, script: &str) -> Result<String> {
        // Execute PowerShell script on remote Hyper-V host via WinRM
        // For now, this is a stub that returns mock data
        // In production, use `winrm` crate or invoke `powershell` via SSH/WinRM

        #[cfg(target_os = "windows")]
        {
            // Local execution for testing
            let output = tokio::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", script])
                .output()
                .await?;

            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).to_string());
            }
            return Err(anyhow!(
                "PowerShell failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        #[cfg(not(target_os = "windows"))]
        {
            // Remote execution via WinRM would go here
            // For now, return mock data for development
            let _ = script;
            Err(anyhow!("Hyper-V remote management requires WinRM (Windows)"))
        }
    }
}

#[async_trait]
impl HypervisorConnector for HyperVConnector {
    async fn connect(&self) -> Result<()> {
        let script = r#"Get-VM | Select-Object -First 1 | ConvertTo-Json"#;
        let _ = self.run_powershell(script).await?;
        Ok(())
    }

    async fn test_connection(&self) -> Result<()> {
        let script = r#"Get-VM | Measure-Object | ConvertTo-Json"#;
        self.run_powershell(script).await?;
        Ok(())
    }

    async fn list_vms(&self) -> Result<Vec<VmInfo>> {
        let script = r#"
Get-VM | ForEach-Object {
    [PSCustomObject]@{
        Id = $_.Id
        Name = $_.Name
        PowerState = $_.State
        CPUCount = $_.ProcessorCount
        MemoryMB = $_.MemoryStartup / 1MB
        GuestOS = $_.GuestOS
    }
} | ConvertTo-Json -Compress
"#;
        let output = self.run_powershell(script).await?;

        // Parse JSON output
        let vms: Vec<VmSummary> = serde_json::from_str(&output)
            .unwrap_or_default();

        let mut result = Vec::new();
        for vm in vms {
            let power_state = match vm.power_state.to_lowercase().as_str() {
                "running" | "2" => PowerState::PoweredOn,
                "off" | "1" => PowerState::PoweredOff,
                "suspended" | "3" => PowerState::Suspended,
                _ => PowerState::PoweredOff,
            };

            result.push(VmInfo {
                id: vm.id.clone(),
                name: vm.name,
                hypervisor_id: String::new(),
                mo_ref: vm.id,
                power_state,
                os: Some(vm.guest_os),
                cpu_count: vm.cpu_count,
                ram_mb: vm.memory_mb,
                disks: Vec::new(),
                networks: Vec::new(),
            });
        }

        Ok(result)
    }

    async fn get_vm(&self, mo_ref: &str) -> Result<VmInfo> {
        let script = format!(
            r#"Get-VM -Id "{}" | Select-Object Id, Name, State, ProcessorCount, @{{
                Name='MemoryMB'; Expression={{$_.MemoryStartup / 1MB}}
            }}, GuestOS | ConvertTo-Json -Compress"#,
            mo_ref
        );

        let output = self.run_powershell(&script).await?;
        let vm: VmSummary = serde_json::from_str(&output)
            .map_err(|e| anyhow!("Failed to parse VM info: {}", e))?;

        let power_state = match vm.power_state.to_lowercase().as_str() {
            "running" | "2" => PowerState::PoweredOn,
            _ => PowerState::PoweredOff,
        };

        Ok(VmInfo {
            id: vm.id,
            name: vm.name,
            hypervisor_id: String::new(),
            mo_ref: mo_ref.to_string(),
            power_state,
            os: Some(vm.guest_os),
            cpu_count: vm.cpu_count,
            ram_mb: vm.memory_mb,
            disks: Vec::new(),
            networks: Vec::new(),
        })
    }

    async fn create_snapshot(
        &self,
        vm_ref: &str,
        name: &str,
        description: &str,
        _quiesce: bool,
        _memory: bool,
    ) -> Result<VmSnapshot> {
        let script = format!(
            r#"Checkpoint-VM -Id "{}" -SnapshotName "{}" -Description "{}" -PassThru | Select-Object Id,Name | ConvertTo-Json"#,
            vm_ref, name, description
        );

        let output = self.run_powershell(&script).await?;

        #[derive(Deserialize)]
        struct SnapshotResp {
            id: String,
            name: String,
        }

        let resp: SnapshotResp = serde_json::from_str(&output)
            .map_err(|e| anyhow!("Failed to parse snapshot response: {}", e))?;

        Ok(VmSnapshot {
            id: resp.id,
            name: Some(resp.name),
            description: Some(description.to_string()),
            created_at: chrono::Utc::now().timestamp(),
            state: PowerState::PoweredOn,
            quiesced: false,
        })
    }

    async fn remove_snapshot(&self, vm_ref: &str, snapshot_id: &str) -> Result<()> {
        let script = format!(
            r#"Remove-VMSnapshot -VmId "{}" -SnapshotId "{}" -Confirm:$false"#,
            vm_ref, snapshot_id
        );
        self.run_powershell(&script).await?;
        Ok(())
    }

    async fn get_changed_blocks(
        &self,
        vm_ref: &str,
        disk_id: &str,
        change_id: &str,
    ) -> Result<Vec<ChangedBlock>> {
        // Hyper-V RCT (Resilient Change Tracking) via WMI
        // RCT data is accessed through the Hyper-V WMI provider:
        // Msvm_ReservedRangesOfStorageExtent
        let script = format!(
            r#"
\$vm = Get-VM -Id "{vm}"
\$disk = Get-VMHardDiskDrive -VM \$vm | Where-Object {{ \$_.Id -eq "{disk}" }}
\$rct = \$disk | Get-VMSwitchExtension -Name "RCT"
if (\$rct) {{
    \$changes = \$rct | Get-VMChangeTracking
    \$changes | ForEach-Object {{
        [PSCustomObject]@{{
            Offset = \$_.Offset
            Length = \$_.Length
        }}
    }} | ConvertTo-Json -Compress
}} else {{
    "[]"
}}"#,
            vm = vm_ref,
            disk = disk_id,
        );

        let output = self.run_powershell(&script).await?;
        let blocks: Vec<ChangedBlock> = serde_json::from_str(&output)
            .unwrap_or_default();
        Ok(blocks)
    }

    async fn get_change_id(&self, vm_ref: &str, disk_id: &str) -> Result<Option<String>> {
        let script = format!(
            r#"
\$vm = Get-VM -Id "{vm}"
\$disk = Get-VMHardDiskDrive -VM \$vm | Where-Object {{ \$_.Id -eq "{disk}" }}
\$rct = \$disk | Get-VMSwitchExtension -Name "RCT"
if (\$rct -and \$rct.ChangeTrackingEnabled) {{
    \$rct.ChangeTrackingId
}} else {{
    \$null
}}"#,
            vm = vm_ref,
            disk = disk_id,
        );

        let output = self.run_powershell(&script).await?;
        let id = output.trim();
        if id.is_empty() || id == "$null" {
            Ok(None)
        } else {
            Ok(Some(id.to_string()))
        }
    }

    async fn read_disk_blocks(
        &self,
        vm_ref: &str,
        disk_path: &str,
        offset: i64,
        length: i64,
    ) -> Result<Vec<u8>> {
        Err(anyhow!(
            "Direct disk block read not supported for Hyper-V. Disk: {} offset: {}",
            disk_path, offset
        ))
    }
}

#[derive(Debug, Deserialize)]
struct VmSummary {
    id: String,
    name: String,
    power_state: String,
    cpu_count: i32,
    memory_mb: i64,
    guest_os: String,
}

pub fn create_connector(
    host: &str, username: &str, password: &str, use_ssl: bool,
) -> Box<dyn HypervisorConnector> {
    Box::new(HyperVConnector::new(host, username, password, use_ssl))
}
