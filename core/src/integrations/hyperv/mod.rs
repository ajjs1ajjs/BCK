use anyhow::{Result, anyhow};
use async_trait::async_trait;
use base64::Engine;
use serde::Deserialize;
use tracing::info;

use crate::integrations::{
    ChangedBlock, HypervisorConnector, PowerState,
    VmDiskInfo, VmInfo, VmNetworkInfo, VmSnapshot,
};

/// Hyper-V connector.
///
/// Commands run as PowerShell on the target host:
/// - when `host` is the local machine, `powershell.exe` runs directly;
/// - otherwise Windows hosts are managed remotely over WinRM through
///   `Invoke-Command -ComputerName` (bckd must run on Windows for the remote
///   path, or be the Hyper-V host itself);
/// - on non-Windows hosts remote WinRM is not available yet — a backup proxy
///   should be used instead.
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

    /// True when the target is the machine bckd runs on.
    fn is_local(&self) -> bool {
        self.host.is_empty()
            || self.host == "localhost"
            || self.host == "127.0.0.1"
            || self.host == "::1"
            || self.host == "."
    }

    /// Execute a PowerShell script on the Hyper-V host and return stdout.
    async fn run_powershell(&self, script: &str) -> Result<String> {
        if self.is_local() {
            self.run_local(script).await
        } else if cfg!(target_os = "windows") {
            self.run_remote_winrm(script).await
        } else {
            Err(anyhow!(
                "Remote Hyper-V management requires WinRM. Run bckd on Windows or use a backup proxy. Host: {}",
                self.host
            ))
        }
    }

    async fn run_local(&self, script: &str) -> Result<String> {
        let output = tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .await
            .map_err(|e| anyhow!("failed to launch powershell: {}", e))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(anyhow!(
                "PowerShell failed ({}): {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    }

    /// Run a script on a remote host via WinRM. The script is transferred as
    /// base64 so quotes/newlines are preserved, and invoked with
    /// `Invoke-Command` using the configured credentials.
    async fn run_remote_winrm(&self, script: &str) -> Result<String> {
        let encoded = base64::engine::general_purpose::STANDARD.encode(script.as_bytes());
        let session_option = if self.use_ssl { "-UseSSL" } else { "" };
        let ps = format!(
            r#"$ErrorActionPreference = 'Stop'
$__s = [ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{enc}')))
$__pw = ConvertTo-SecureString '{pw}' -AsPlainText -Force
$__cred = New-Object System.Management.Automation.PSCredential('{user}', $__pw)
$__opt = New-PSSessionOption -OperationTimeout 120000 -OpenTimeout 120000
Invoke-Command -ComputerName '{host}' -Credential $__cred -SessionOption $__opt {ssl} -ScriptBlock $__s -ErrorAction Stop
"#,
            enc = encoded,
            pw = self.password.replace('\'', "''"),
            user = self.username.replace('\'', "''"),
            host = self.host.replace('\'', "''"),
            ssl = session_option,
        );
        self.run_local(&ps).await
    }

    /// Run a script and parse the output as a JSON array, tolerating the
    /// PowerShell behaviour of emitting a bare object for a single result.
    async fn query_json<T: serde::de::DeserializeOwned>(&self, script: &str) -> Result<Vec<T>> {
        let output = self.run_powershell(script).await?;
        parse_json_array(&output)
    }
}

/// Wrap a single JSON object into an array (PowerShell `ConvertTo-Json`
/// returns a bare object when there is exactly one result).
fn parse_json_array<T: serde::de::DeserializeOwned>(output: &str) -> Result<Vec<T>> {
    let trimmed = output.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('{') {
        let v: T = serde_json::from_str(trimmed)?;
        return Ok(vec![v]);
    }
    Ok(serde_json::from_str(trimmed)?)
}

#[derive(Debug, Deserialize)]
struct VmJson {
    id: String,
    name: String,
    state: Option<String>,
    cpu_count: Option<i32>,
    memory_mb: Option<i64>,
    guest_os: Option<String>,
    #[serde(default)]
    disks: Vec<DiskJson>,
    #[serde(default)]
    networks: Vec<NetworkJson>,
}

#[derive(Debug, Deserialize)]
struct DiskJson {
    id: String,
    label: Option<String>,
    path: String,
    capacity_bytes: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct NetworkJson {
    label: Option<String>,
    switch_name: Option<String>,
    mac_address: Option<String>,
}

fn power_state_from(s: Option<&str>) -> PowerState {
    match s.map(|v| v.to_lowercase()).as_deref() {
        Some("running") | Some("2") => PowerState::PoweredOn,
        Some("suspended") | Some("3") => PowerState::Suspended,
        _ => PowerState::PoweredOff,
    }
}

fn vm_from_json(vm: VmJson) -> VmInfo {
    let disks = vm.disks.into_iter().map(|d| VmDiskInfo {
        disk_id: d.id,
        label: d.label.unwrap_or_else(|| d.path.clone()),
        capacity_bytes: d.capacity_bytes.unwrap_or(0),
        disk_path: d.path,
        datastore: String::new(),
        change_id: None,
    }).collect();

    let networks = vm.networks.into_iter().map(|n| VmNetworkInfo {
        label: n.label.unwrap_or_default(),
        network_name: n.switch_name,
        mac_address: n.mac_address,
    }).collect();

    VmInfo {
        id: vm.id.clone(),
        name: vm.name,
        hypervisor_id: String::new(),
        mo_ref: vm.id,
        power_state: power_state_from(vm.state.as_deref()),
        os: vm.guest_os,
        cpu_count: vm.cpu_count.unwrap_or(0),
        ram_mb: vm.memory_mb.unwrap_or(0),
        disks,
        networks,
    }
}

#[async_trait]
impl HypervisorConnector for HyperVConnector {
    async fn connect(&self) -> Result<()> {
        let _ = self.run_powershell(r#"Get-VM | Select-Object -First 1 | Out-Null"#).await?;
        Ok(())
    }

    async fn test_connection(&self) -> Result<()> {
        let output = self.run_powershell(r#"$ErrorActionPreference='Stop'; Get-VM | Measure-Object | Select-Object -ExpandProperty Count"#).await?;
        tracing::info!("Hyper-V host {} reports {} VM(s)", self.host, output.trim());
        Ok(())
    }

    async fn list_vms(&self) -> Result<Vec<VmInfo>> {
        let script = r#"
$ErrorActionPreference = 'Stop'
$vms = Get-VM
if (-not $vms) { @() | ConvertTo-Json -Compress; return }
$vms | ForEach-Object {
    $vm = $_
    $disks = @(Get-VMHardDiskDrive -VM $vm | ForEach-Object {
        $sz = 0L
        if (Test-Path $_.Path) {
            try { $vhd = Get-VHD -Path $_.Path -ErrorAction Stop; $sz = [int64]$vhd.Size } catch { $sz = 0L }
        }
        [PSCustomObject]@{
            Id = $_.Path
            Label = "$($_.ControllerType) $($_.ControllerNumber):$($_.ControllerLocation)"
            Path = $_.Path
            CapacityBytes = $sz
        }
    })
    $nics = @(Get-VMNetworkAdapter -VM $vm | ForEach-Object {
        [PSCustomObject]@{
            Label = $_.Name
            SwitchName = $_.SwitchName
            MacAddress = $_.MacAddress
        }
    })
    [PSCustomObject]@{
        Id = $vm.Id
        Name = $vm.Name
        State = $vm.State
        ProcessorCount = $vm.ProcessorCount
        MemoryMB = [int64]($vm.MemoryStartup / 1MB)
        GuestOS = $vm.GuestOS
        Disks = $disks
        Networks = $nics
    }
} | ConvertTo-Json -Depth 6 -Compress
"#;
        let vms = self.query_json::<VmJson>(script).await?;
        Ok(vms.into_iter().map(vm_from_json).collect())
    }

    async fn get_vm(&self, mo_ref: &str) -> Result<VmInfo> {
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
$vm = Get-VM -Id '{vm}'
$disks = @(Get-VMHardDiskDrive -VM $vm | ForEach-Object {{
    $sz = 0L
    if (Test-Path $_.Path) {{
        try {{ $vhd = Get-VHD -Path $_.Path -ErrorAction Stop; $sz = [int64]$vhd.Size }} catch {{ $sz = 0L }}
    }}
    [PSCustomObject]@{{
        Id = $_.Path
        Label = "$($_.ControllerType) $($_.ControllerNumber):$($_.ControllerLocation)"
        Path = $_.Path
        CapacityBytes = $sz
    }}
}})
$nics = @(Get-VMNetworkAdapter -VM $vm | ForEach-Object {{
    [PSCustomObject]@{{
        Label = $_.Name
        SwitchName = $_.SwitchName
        MacAddress = $_.MacAddress
    }}
}})
[PSCustomObject]@{{
    Id = $vm.Id
    Name = $vm.Name
    State = $vm.State
    ProcessorCount = $vm.ProcessorCount
    MemoryMB = [int64]($vm.MemoryStartup / 1MB)
    GuestOS = $vm.GuestOS
    Disks = $disks
    Networks = $nics
}} | ConvertTo-Json -Depth 6 -Compress"#,
            vm = mo_ref.replace('\'', "''"),
        );

        let mut vms = self.query_json::<VmJson>(&script).await?;
        vms.pop()
            .map(vm_from_json)
            .ok_or_else(|| anyhow!("VM not found: {}", mo_ref))
    }

    async fn power_on(&self, vm_ref: &str) -> Result<()> {
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
Start-VM -Id '{vm}' -Confirm:$false"#,
            vm = vm_ref.replace('\'', "''"),
        );
        self.run_powershell(&script).await?;
        info!("Hyper-V VM powered on: {}", vm_ref);
        Ok(())
    }

    async fn power_off(&self, vm_ref: &str, force: bool) -> Result<()> {
        let force_arg = if force { " -Force" } else { "" };
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
Stop-VM -Id '{vm}' -Confirm:$false{force}"#,
            vm = vm_ref.replace('\'', "''"),
            force = force_arg,
        );
        self.run_powershell(&script).await?;
        info!("Hyper-V VM powered off (force={}): {}", force, vm_ref);
        Ok(())
    }

    async fn create_snapshot(
        &self,
        vm_ref: &str,
        name: &str,
        description: &str,
        _quiesce: bool,
        _memory: bool,
    ) -> Result<VmSnapshot> {
        #[derive(Deserialize)]
        struct SnapshotResp {
            id: String,
            name: Option<String>,
        }

        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
Checkpoint-VM -Id '{vm}' -SnapshotName '{name}' -Description '{desc}' -AsSnapshot -PassThru |
    Select-Object Id, Name | ConvertTo-Json -Compress"#,
            vm = vm_ref.replace('\'', "''"),
            name = name.replace('\'', "''"),
            desc = description.replace('\'', "''"),
        );

        let output = self.run_powershell(&script).await?;
        let resp: SnapshotResp = serde_json::from_str(output.trim())
            .map_err(|e| anyhow!("Failed to parse snapshot response: {} (output: {})", e, output))?;

        Ok(VmSnapshot {
            id: resp.id,
            name: Some(resp.name.unwrap_or_else(|| name.to_string())),
            description: Some(description.to_string()),
            created_at: chrono::Utc::now().timestamp(),
            state: PowerState::PoweredOn,
            quiesced: _quiesce,
        })
    }

    async fn remove_snapshot(&self, vm_ref: &str, snapshot_id: &str) -> Result<()> {
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
Get-VMSnapshot -VMId '{vm}' | Where-Object {{ $_.Id -eq '{snap}' }} |
    Remove-VMSnapshot -Confirm:$false"#,
            vm = vm_ref.replace('\'', "''"),
            snap = snapshot_id.replace('\'', "''"),
        );
        self.run_powershell(&script).await?;
        Ok(())
    }

    async fn get_changed_blocks(
        &self,
        vm_ref: &str,
        disk_path: &str,
        change_id: &str,
    ) -> Result<Vec<ChangedBlock>> {
        // RCT ranges are exposed by the Hyper-V WMI provider. The VHDX
        // DiskIdentifier matches the ranges owned by this disk. If the
        // provider is unavailable (RCT disabled / older host) we fall back to
        // the whole disk so the backup stays correct.
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
$vm = Get-VM -Id '{vm}'
$disk = Get-VMHardDiskDrive -VM $vm | Where-Object {{ $_.Path -eq '{disk}' }}
if (-not $disk) {{ @() | ConvertTo-Json -Compress; return }}
$ident = $null
try {{ $ident = (Get-VHD -Path $disk.Path).DiskIdentifier }} catch {{ $ident = $null }}
if (-not $ident) {{ @() | ConvertTo-Json -Compress; return }}
$ranges = Get-CimInstance -Namespace root/virtualization/v2 -ClassName Msvm_ReservedRangesOfStorageExtent -ErrorAction SilentlyContinue |
    Where-Object {{ $_.Name -like "*$ident*" -or $_.ElementName -like "*$ident*" }}
if (-not $ranges) {{
    $size = (Get-VHD -Path $disk.Path).Size
    @([PSCustomObject]@{{ Offset = 0L; Length = [int64]$size }}) | ConvertTo-Json -Compress
    return
}}
$ranges | ForEach-Object {{
    [PSCustomObject]@{{
        Offset = [int64]$_.StartingAddress
        Length = [int64]($_.EndingAddress - $_.StartingAddress)
    }}
}} | ConvertTo-Json -Compress"#,
            vm = vm_ref.replace('\'', "''"),
            disk = disk_path.replace('\'', "''"),
        );

        let _ = change_id; // ranges are read fresh from the provider
        Ok(self.query_json::<ChangedBlock>(&script).await?)
    }

    async fn get_change_id(&self, vm_ref: &str, disk_path: &str) -> Result<Option<String>> {
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
$vm = Get-VM -Id '{vm}'
$disk = Get-VMHardDiskDrive -VM $vm | Where-Object {{ $_.Path -eq '{disk}' }}
if ($disk -and (Test-Path $disk.Path)) {{
    try {{
        $vhd = Get-VHD -Path $disk.Path -ErrorAction Stop
        if ($vhd.ChangeTrackingState -eq 'Enabled') {{ $vhd.ChangeTrackingId }} else {{ $null }}
    }} catch {{ $null }}
}} else {{ $null }}"#,
            vm = vm_ref.replace('\'', "''"),
            disk = disk_path.replace('\'', "''"),
        );

        let output = self.run_powershell(&script).await?;
        let id = output.trim().trim_matches('"');
        if id.is_empty() || id.eq_ignore_ascii_case("$null") || id == "null" {
            Ok(None)
        } else {
            Ok(Some(id.to_string()))
        }
    }

    async fn read_disk_blocks(
        &self,
        _vm_ref: &str,
        disk_path: &str,
        offset: i64,
        length: i64,
    ) -> Result<Vec<u8>> {
        if length <= 0 || length > 64 * 1024 * 1024 {
            return Err(anyhow!("Invalid read length: {}", length));
        }
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
$path = '{path}'
if (-not (Test-Path $path)) {{ throw "Disk not accessible: $path" }}
$fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
try {{
    $fs.Position = {offset}
    $buf = New-Object byte[] {len}
    $read = $fs.Read($buf, 0, {len})
    [Convert]::ToBase64String($buf, 0, $read)
}} finally {{ $fs.Dispose() }}"#,
            path = disk_path.replace('\'', "''"),
            offset = offset,
            len = length,
        );

        let output = self.run_powershell(&script).await?;
        let b64 = output.trim();
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| anyhow!("Failed to decode disk block data: {}", e))
    }

    async fn register_vm(
        &self,
        vm_name: &str,
        disk_files: &[String],
        datastore: &str,
        power_on: bool,
    ) -> Result<String> {
        let disk = disk_files.iter()
            .find(|p| p.to_lowercase().ends_with(".vhdx") || p.to_lowercase().ends_with(".vhd"))
            .cloned()
            .ok_or_else(|| anyhow!("No VHD/VHDX file found among restored files for VM registration"))?;

        let power = if power_on { "Start-VM -VM $vm" } else { "" };
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
$vm = New-VM -Name '{name}' -VHD '{disk}' -Path '{path}' -Generation 2 -Confirm:$false -ErrorAction Stop
{power}
$vm.Id"#,
            name = vm_name.replace('\'', "''"),
            disk = disk.replace('\'', "''"),
            path = datastore.replace('\'', "''"),
            power = power,
        );
        let output = self.run_powershell(&script).await?;
        Ok(output.trim().to_string())
    }

    async fn unregister_vm(&self, vm_ref: &str) -> Result<()> {
        let script = format!(
            r#"$ErrorActionPreference = 'Stop'
$vm = Get-VM -Id '{id}' -ErrorAction Stop
Stop-VM -VM $vm -Force -Confirm:$false -ErrorAction SilentlyContinue
Remove-VM -VM $vm -Force -Confirm:$false"#,
            id = vm_ref.replace('\'', "''"),
        );
        self.run_powershell(&script).await?;
        Ok(())
    }
}

pub fn create_connector(
    host: &str, username: &str, password: &str, use_ssl: bool,
) -> Box<dyn HypervisorConnector> {
    Box::new(HyperVConnector::new(host, username, password, use_ssl))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_object_as_array() {
        let json = r#"{"id":"a","name":"VM1","state":"Running","disks":[],"networks":[]}"#;
        let vms = parse_json_array::<VmJson>(json).unwrap();
        assert_eq!(vms.len(), 1);
        assert_eq!(vms[0].name, "VM1");
        let info = vm_from_json(vms.into_iter().next().unwrap());
        assert_eq!(info.power_state, PowerState::PoweredOn);
    }

    #[test]
    fn parse_array_with_nested_disks() {
        let json = r#"[
          {"id":"a","name":"VM1","state":"Off","processor_count":2,"memory_mb":4096,
           "guest_os":"Windows Server 2022",
           "disks":[{"id":"D:\\vms\\vm1\\vm1.vhdx","label":"SCSI 0:0","path":"D:\\vms\\vm1\\vm1.vhdx","capacity_bytes":10737418240}],
           "networks":[{"label":"Ethernet","switch_name":"Default Switch","mac_address":"00-11-22-33-44-55"}]}
        ]"#;
        let vms = parse_json_array::<VmJson>(json).unwrap();
        let info = vm_from_json(vms.into_iter().next().unwrap());
        assert_eq!(info.disks.len(), 1);
        assert_eq!(info.disks[0].disk_path, "D:\\vms\\vm1\\vm1.vhdx");
        assert_eq!(info.disks[0].capacity_bytes, 10737418240);
        assert_eq!(info.networks[0].network_name.as_deref(), Some("Default Switch"));
        assert_eq!(info.power_state, PowerState::PoweredOff);
    }

    #[test]
    fn parse_empty_output_is_empty_list() {
        assert!(parse_json_array::<VmJson>("").unwrap().is_empty());
        assert!(parse_json_array::<VmJson>("null").unwrap().is_empty());
        assert!(parse_json_array::<VmJson>("[]").unwrap().is_empty());
    }

    #[test]
    fn changed_blocks_parse() {
        let json = r#"[{"offset":0,"length":4096},{"offset":1048576,"length":8192}]"#;
        let blocks = parse_json_array::<ChangedBlock>(json).unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[1].offset, 1048576);
    }

    #[test]
    fn local_host_detection() {
        assert!(HyperVConnector::new("localhost", "u", "p", false).is_local());
        assert!(HyperVConnector::new("127.0.0.1", "u", "p", false).is_local());
        assert!(HyperVConnector::new("", "u", "p", false).is_local());
        assert!(!HyperVConnector::new("hv01.corp.local", "u", "p", false).is_local());
    }

    #[test]
    fn power_state_mapping() {
        assert_eq!(power_state_from(Some("Running")), PowerState::PoweredOn);
        assert_eq!(power_state_from(Some("Suspended")), PowerState::Suspended);
        assert_eq!(power_state_from(Some("Off")), PowerState::PoweredOff);
        assert_eq!(power_state_from(None), PowerState::PoweredOff);
    }
}
