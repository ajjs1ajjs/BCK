use anyhow::{anyhow, Result};
use chrono::Utc;
use serde_json::{json, Value};
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::info;

const API_VERSION: &str = "2023-07-01";
const OAUTH_SCOPE: &str = "https://management.azure.com/.default";

/// Azure VM backup using snapshots and restore points
pub struct AzureVmBackup {
    client: reqwest::Client,
    subscription_id: String,
    resource_group: String,
    tenant_id: String,
    client_id: String,
    client_secret: String,
    token: RwLock<Option<(String, i64)>>,
}

impl AzureVmBackup {
    pub fn new(
        subscription_id: String,
        resource_group: String,
        tenant_id: String,
        client_id: String,
        client_secret: String,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            subscription_id,
            resource_group,
            tenant_id,
            client_id,
            client_secret,
            token: RwLock::new(None),
        }
    }

    async fn ensure_token(&self) -> Result<String> {
        {
            let guard = self
                .token
                .read()
                .map_err(|_| anyhow!("azure vm token lock poisoned"))?;
            if let Some((tok, exp)) = guard.as_ref() {
                if *exp > now_unix() + 60 {
                    return Ok(tok.clone());
                }
            }
        }
        let url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            self.tenant_id
        );
        let form = [
            ("client_id", self.client_id.as_str()),
            ("client_secret", self.client_secret.as_str()),
            ("scope", OAUTH_SCOPE),
            ("grant_type", "client_credentials"),
        ];
        let resp = self.client.post(&url).form(&form).send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure OAuth2 token request failed: {status} {body}");
        }
        let json: Value = serde_json::from_str(&body)?;
        let access_token = json["access_token"]
            .as_str()
            .ok_or_else(|| anyhow!("Azure OAuth2 response missing access_token"))?
            .to_string();
        let expires_in = json["expires_in"].as_u64().unwrap_or(3600);
        let expires_at = now_unix() + expires_in as i64;
        let mut guard = self
            .token
            .write()
            .map_err(|_| anyhow!("azure vm token lock poisoned"))?;
        *guard = Some((access_token.clone(), expires_at));
        Ok(access_token)
    }

    fn vm_base_url(&self, vm_name: &str) -> String {
        format!(
            "https://management.azure.com/subscriptions/{}/resourceGroups/{}/providers/Microsoft.Compute/virtualMachines/{vm_name}",
            self.subscription_id, self.resource_group
        )
    }

    /// Create restore point collection for a VM. Returns the restore point resource id.
    pub async fn create_restore_point(&self, vm_id: &str, name: &str) -> Result<String> {
        let token = self.ensure_token().await?;
        let vm = vm_name_from_id(vm_id);
        let rp_url = format!(
            "{}/restorePoints/{name}?api-version={API_VERSION}",
            self.vm_base_url(vm)
        );
        let body = json!({ "consistencyMode": "CrashConsistent" });
        info!("Creating Azure VM restore point: {vm_id} -> {name}");
        let resp = self
            .client
            .put(&rp_url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure create restore point failed: {status} {text}");
        }

        let rp = poll_arm_resource(&self.client, &rp_url, &token, "restore point", 60, 5).await?;
        let restore_point_id = rp["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| rp_url.split('?').next().unwrap_or(&rp_url).to_string());
        Ok(restore_point_id)
    }

    /// List restore points for a VM
    pub async fn list_restore_points(&self, vm_id: &str) -> Result<Vec<String>> {
        let token = self.ensure_token().await?;
        let vm = vm_name_from_id(vm_id);
        let url = format!(
            "{}/restorePoints?api-version={API_VERSION}",
            self.vm_base_url(vm)
        );
        let resp = self.client.get(&url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure list restore points failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        let mut names = Vec::new();
        if let Some(items) = json["value"].as_array() {
            for item in items {
                if let Some(n) = item["name"].as_str() {
                    names.push(n.to_string());
                }
            }
        }
        Ok(names)
    }

    /// Restore VM from restore point: copy source disk, then deploy a new VM.
    pub async fn restore_vm(&self, restore_point_id: &str, new_vm_name: &str) -> Result<()> {
        let token = self.ensure_token().await?;

        let rp_url = format!("{restore_point_id}?api-version={API_VERSION}");
        let resp = self.client.get(&rp_url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure get restore point failed: {status} {text}");
        }
        let rp: Value = serde_json::from_str(&text)?;

        let vm_id = vm_id_from_restore_point(restore_point_id);
        let vm = self.get_vm(&vm_id).await?;
        let vm_location = vm["location"].as_str().unwrap_or("eastus").to_string();
        let os_type = vm["properties"]["storageProfile"]["osDisk"]["osType"]
            .as_str()
            .unwrap_or("Linux")
            .to_string();

        let source_disk = rp["properties"]["diskRestorePoints"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|d| d["sourceResourceId"].as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                vm["properties"]["storageProfile"]["osDisk"]["managedDisk"]["id"]
                    .as_str()
                    .unwrap_or("")
                    .to_string()
            });
        if source_disk.is_empty() {
            anyhow::bail!("could not determine source disk for restore point {restore_point_id}");
        }

        let disk_name = format!("bck-{new_vm_name}-{}", Utc::now().format("%Y%m%d%H%M%S"));
        let disks_url = format!(
            "https://management.azure.com/subscriptions/{}/resourceGroups/{}/providers/Microsoft.Compute/disks/{disk_name}?api-version={API_VERSION}",
            self.subscription_id, self.resource_group
        );
        let disk_body = json!({
            "location": vm_location,
            "properties": {
                "creationData": {
                    "createOption": "Copy",
                    "sourceResourceId": source_disk
                }
            }
        });
        info!("Creating restored disk {disk_name} from {source_disk}");
        let resp = self
            .client
            .put(&disks_url)
            .bearer_auth(&token)
            .json(&disk_body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure create disk failed: {status} {text}");
        }
        let disk =
            poll_arm_resource(&self.client, &disks_url, &token, "disk", 300, 10).await?;
        let new_disk_id = disk["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| disks_url.split('?').next().unwrap_or(&disks_url).to_string());

        let vm_url = format!(
            "https://management.azure.com/subscriptions/{}/resourceGroups/{}/providers/Microsoft.Compute/virtualMachines/{new_vm_name}?api-version={API_VERSION}",
            self.subscription_id, self.resource_group
        );
        let vm_body = json!({
            "location": vm_location,
            "properties": {
                "hardwareProfile": { "vmSize": "Standard_DS1_v2" },
                "osProfile": {
                    "computerName": new_vm_name,
                    "adminUsername": "bckadmin",
                    "adminPassword": "BCK!Admin123"
                },
                "storageProfile": {
                    "osDisk": {
                        "createOption": "Attach",
                        "managedDisk": { "id": new_disk_id },
                        "osType": os_type
                    }
                }
            }
        });
        info!("Creating restored VM {new_vm_name} from disk {new_disk_id}");
        let resp = self
            .client
            .put(&vm_url)
            .bearer_auth(&token)
            .json(&vm_body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure create VM failed: {status} {text}");
        }
        poll_arm_resource(&self.client, &vm_url, &token, "VM", 300, 10).await?;
        info!("Restored VM {new_vm_name} created successfully");
        Ok(())
    }

    async fn get_vm(&self, vm_id: &str) -> Result<Value> {
        let token = self.ensure_token().await?;
        let url = format!("{vm_id}?api-version={API_VERSION}");
        let resp = self.client.get(&url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure GET VM failed: {status} {text}");
        }
        Ok(serde_json::from_str(&text)?)
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Last path segment of an ARM resource id (the resource name).
fn vm_name_from_id(vm_id: &str) -> &str {
    vm_id.rsplit('/').next().unwrap_or("")
}

/// The VM resource id that owns a restore point id
/// (`.../virtualMachines/{vm}/restorePoints/{rp}` -> `.../virtualMachines/{vm}`).
fn vm_id_from_restore_point(restore_point_id: &str) -> String {
    restore_point_id
        .split("/restorePoints/")
        .next()
        .map(|s| s.to_string())
        .unwrap_or_else(|| restore_point_id.to_string())
}

/// Poll an ARM resource until `properties.provisioningState == "Succeeded"`.
async fn poll_arm_resource(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    what: &str,
    timeout_secs: u64,
    interval_secs: u64,
) -> Result<Value> {
    let deadline = SystemTime::now() + Duration::from_secs(timeout_secs);
    loop {
        let resp = client.get(url).bearer_auth(token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure GET {what} failed: {status} {text}");
        }
        let v: Value = serde_json::from_str(&text)?;
        let state = v["properties"]["provisioningState"]
            .as_str()
            .unwrap_or("Unknown");
        info!("{what} provisioningState={state}");
        if state == "Succeeded" {
            return Ok(v);
        }
        if state == "Failed" {
            anyhow::bail!("Azure {what} provisioning failed");
        }
        if SystemTime::now() > deadline {
            anyhow::bail!("Azure {what} timed out waiting for provisioning to succeed");
        }
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vm_name_from_id() {
        assert_eq!(
            vm_name_from_id("/subscriptions/s/rg/g/providers/Microsoft.Compute/virtualMachines/web-01"),
            "web-01"
        );
        assert_eq!(vm_name_from_id("web-01"), "web-01");
        assert_eq!(vm_name_from_id(""), "");
    }

    #[test]
    fn test_vm_id_from_restore_point() {
        let rp = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/web-01/restorePoints/rp-001";
        assert_eq!(
            vm_id_from_restore_point(rp),
            "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/web-01"
        );
        assert_eq!(vm_id_from_restore_point("/plain/id"), "/plain/id");
    }
}
