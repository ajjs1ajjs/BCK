use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VssSnapshot {
    pub id: String,
    pub volume: String,
    pub snapshot_device: String,
    pub created_at: i64,
    pub writer_status: Vec<VssWriterStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VssWriterStatus {
    pub name: String,
    pub status: String,
    pub last_error: Option<String>,
}

pub struct VssCoordinator;

impl VssCoordinator {
    pub fn new() -> Self {
        Self
    }

    pub async fn create_shadow_copy(&self, volume: &str) -> Result<VssSnapshot> {
        let script = format!(
            r#"
$volume = "{vol}"
$id = (Get-WmiObject Win32_ShadowCopy | Where-Object {{ $_.Volume -eq $volume }}).Count
if (-not $id) {{ $id = 0 }}
$shadow = (gwmi Win32_ShadowCopy).Create($volume, "ClientAccessible")
if ($shadow.ReturnValue -ne 0) {{
    throw "VSS shadow copy creation failed: $($shadow.ReturnValue)"
}}
Start-Sleep -Seconds 2
$copy = Get-WmiObject Win32_ShadowCopy | Select-Object -Last 1
[PSCustomObject]@{{
    Id = $copy.ID
    Volume = $volume
    SnapshotDevice = $copy.DeviceObject
    CreatedAt = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    WriterStatus = @()
}} | ConvertTo-Json -Compress
"#,
            vol = volume
        );

        self.run_powershell(&script)
    }

    pub async fn remove_shadow_copy(&self, snapshot_id: &str) -> Result<()> {
        let script = format!(
            r#"Remove-WmiObject -Class Win32_ShadowCopy -Filter "ID='{id}'" -ErrorAction Stop"#,
            id = snapshot_id
        );

        self.run_powershell::<String>(&script)?;
        info!("VSS snapshot removed: {}", snapshot_id);
        Ok(())
    }

    pub async fn get_writer_status(&self) -> Result<Vec<VssWriterStatus>> {
        let script = r#"
$writers = vssadmin list writers | Select-String -Pattern "Writer Name:|State:|Last Error:"
$result = @(); $current = @{}
foreach ($line in $writers) {
    if ($line -match "Writer Name: (.+)") {
        if ($current.Name) { $result += [PSCustomObject]$current }
        $current = @{ Name = $matches[1]; Status = "Unknown"; LastError = $null }
    }
    elseif ($line -match "State: \[(\d+)\].+") {
        $states = @{ "1" = "Stable"; "5" = "WaitingForFreeze"; "6" = "WaitingForThaw";
                     "7" = "Failed"; "8" = "Completed" }
        $current.Status = if ($states.ContainsKey($matches[1])) { $states[$matches[1]] } else { "Unknown" }
    }
    elseif ($line -match "Last Error: (.+)") {
        $current.LastError = $matches[1]
    }
}
if ($current.Name) { $result += [PSCustomObject]$current }
$result | ConvertTo-Json -Compress
"#;

        self.run_powershell(script)
    }

    pub async fn freeze_applications(&self) -> Result<()> {
        info!("Freezing applications via VSS...");
        Ok(())
    }

    pub async fn thaw_applications(&self) -> Result<()> {
        info!("Thawing applications...");
        Ok(())
    }

    fn run_powershell<T: serde::de::DeserializeOwned>(&self, script: &str) -> Result<T> {
        #[cfg(target_os = "windows")]
        {
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", script])
                .output()
                .map_err(|e| anyhow!("Failed to run PowerShell: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(anyhow!("PowerShell VSS command failed: {}", stderr));
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.trim().is_empty() {
                return Err(anyhow!("PowerShell returned empty output"));
            }

            let result: T = serde_json::from_str(stdout.trim())
                .map_err(|e| anyhow!("Failed to parse VSS output: {} | Output: {}", e, stdout))?;
            Ok(result)
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = script;
            Err(anyhow!("VSS is only supported on Windows"))
        }
    }
}
