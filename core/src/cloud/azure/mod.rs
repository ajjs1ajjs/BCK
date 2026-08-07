pub mod vm;
pub mod disks;
pub mod sql;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::info;

use super::CloudAccount;

const OAUTH_SCOPE: &str = "https://management.azure.com/.default";

/// Azure connector — manages Azure VM, Disk, and SQL backups
pub struct AzureConnector {
    account: CloudAccount,
    client: reqwest::Client,
    token: RwLock<Option<(String, i64)>>,
}

impl AzureConnector {
    pub fn new(account: CloudAccount) -> Self {
        Self {
            account,
            client: reqwest::Client::new(),
            token: RwLock::new(None),
        }
    }

    async fn oauth_token(&self) -> Result<(String, i64)> {
        let tenant_id = self
            .account
            .tenant_id
            .as_deref()
            .ok_or_else(|| anyhow!("Azure tenant_id not configured"))?;
        let client_id = self
            .account
            .client_id
            .as_deref()
            .ok_or_else(|| anyhow!("Azure client_id not configured"))?;
        let client_secret = self
            .account
            .client_secret
            .as_deref()
            .ok_or_else(|| anyhow!("Azure client_secret not configured"))?;
        let access_token =
            azure_bearer_token(&self.client, tenant_id, client_id, client_secret, OAUTH_SCOPE)
                .await?;
        Ok((access_token, now_unix() + 3600))
    }

    async fn ensure_token(&self) -> Result<(String, i64)> {
        {
            let guard = self
                .token
                .read()
                .map_err(|_| anyhow!("azure token lock poisoned"))?;
            if let Some((tok, exp)) = guard.as_ref() {
                if *exp > now_unix() + 60 {
                    return Ok((tok.clone(), *exp));
                }
            }
        }
        let (tok, exp) = self.oauth_token().await?;
        let mut guard = self
            .token
            .write()
            .map_err(|_| anyhow!("azure token lock poisoned"))?;
        *guard = Some((tok.clone(), exp));
        Ok((tok, exp))
    }

    /// Authenticate with Azure using an AAD application (client credentials).
    pub async fn authenticate(&self) -> Result<AzureSession> {
        info!("Authenticating with Azure: region={}", self.account.region);
        let (access_token, expires_at) = self.ensure_token().await?;
        Ok(AzureSession {
            subscription_id: String::new(),
            region: self.account.region.clone(),
            access_token,
            expires_at,
        })
    }

    /// List all Azure VMs in the subscription
    pub async fn list_vms(&self) -> Result<Vec<AzureVm>> {
        let session = self.authenticate().await?;
        if session.subscription_id.is_empty() {
            anyhow::bail!("Azure subscription_id is required to list VMs");
        }
        let url = format!(
            "https://management.azure.com/subscriptions/{}/providers/Microsoft.Compute/virtualMachines?api-version=2023-07-01",
            session.subscription_id
        );
        let resp = self
            .client
            .get(&url)
            .bearer_auth(&session.access_token)
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure list VMs failed: {status} {body}");
        }
        let json: Value = serde_json::from_str(&body)?;
        parse_arm_vm_json(&json)
    }
}

pub struct AzureSession {
    pub subscription_id: String,
    pub region: String,
    pub access_token: String,
    pub expires_at: i64,
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

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Build the OAuth2 client-credentials form body for the v2.0 token endpoint.
fn build_azure_oauth_form<'a>(
    client_id: &'a str,
    client_secret: &'a str,
    scope: &str,
) -> Vec<(&'a str, String)> {
    vec![
        ("client_id", client_id.to_string()),
        ("client_secret", client_secret.to_string()),
        ("scope", scope.to_string()),
        ("grant_type", "client_credentials".to_string()),
    ]
}

/// Acquire an Azure OAuth2 bearer token via the client-credentials flow.
pub(crate) async fn azure_bearer_token(
    client: &reqwest::Client,
    tenant_id: &str,
    client_id: &str,
    client_secret: &str,
    scope: &str,
) -> Result<String> {
    let url = format!("https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token");
    let form = build_azure_oauth_form(client_id, client_secret, scope);
    let resp = client.post(&url).form(&form).send().await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        anyhow::bail!("Azure OAuth2 token request failed: {status} {body}");
    }
    let json: Value = serde_json::from_str(&body)?;
    json["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("Azure OAuth2 response missing access_token"))
}

/// Poll an ARM resource until `properties.provisioningState == "Succeeded"`.
pub(crate) async fn poll_azure_resource(
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

/// Extract the resource group name from an ARM resource id
/// (the path segment that follows `resourceGroups/`).
fn parse_azure_resource_group(id: &str) -> String {
    let parts: Vec<&str> = id.split('/').collect();
    for (i, part) in parts.iter().enumerate() {
        if *part == "resourceGroups" {
            if let Some(rg) = parts.get(i + 1) {
                return rg.to_string();
            }
        }
    }
    String::new()
}

/// Parse the ARM `virtualMachines` list response body into `AzureVm`s.
fn parse_arm_vm_json(json: &Value) -> Result<Vec<AzureVm>> {
    let mut vms = Vec::new();
    let Some(items) = json.get("value").and_then(|v| v.as_array()) else {
        return Ok(vms);
    };
    for item in items {
        let id = item["id"].as_str().unwrap_or("").to_string();
        let name = item["name"].as_str().unwrap_or("").to_string();
        let resource_group = parse_azure_resource_group(&id);
        let props = item.get("properties");
        let vm_size = props
            .and_then(|p| p.pointer("/hardwareProfile/vmSize"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let os_type = props
            .and_then(|p| p.pointer("/storageProfile/osDisk/osType"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let mut disks = Vec::new();
        if let Some(sp) = props.and_then(|p| p.get("storageProfile")) {
            if let Some(os) = sp.get("osDisk") {
                let os_id = os["managedDisk"]["id"]
                    .as_str()
                    .or_else(|| os["vhd"]["uri"].as_str())
                    .unwrap_or("")
                    .to_string();
                let os_sku = os["managedDisk"]["storageAccountType"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                disks.push(AzureDisk {
                    id: os_id,
                    name: os["name"].as_str().unwrap_or("").to_string(),
                    size_gb: os["diskSizeGB"].as_u64().unwrap_or(0),
                    sku: os_sku,
                    lun: 0,
                });
            }
            if let Some(data_disks) = sp.get("dataDisks").and_then(|d| d.as_array()) {
                for d in data_disks {
                    disks.push(AzureDisk {
                        id: d["managedDisk"]["id"].as_str().unwrap_or("").to_string(),
                        name: d["name"].as_str().unwrap_or("").to_string(),
                        size_gb: d["diskSizeGB"].as_u64().unwrap_or(0),
                        sku: d["managedDisk"]["storageAccountType"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        lun: d["lun"].as_u64().unwrap_or(0) as u32,
                    });
                }
            }
        }

        vms.push(AzureVm {
            id,
            name,
            resource_group,
            vm_size,
            os_type,
            disks,
        });
    }
    Ok(vms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_build_azure_oauth_form() {
        let form = build_azure_oauth_form("cli-123", "sec-456", "https://management.azure.com/.default");
        assert_eq!(form.len(), 4);
        assert_eq!(form[0], ("client_id", "cli-123".to_string()));
        assert_eq!(form[1], ("client_secret", "sec-456".to_string()));
        assert_eq!(form[2].0, "scope");
        assert_eq!(form[2].1, "https://management.azure.com/.default");
        assert_eq!(form[3], ("grant_type", "client_credentials".to_string()));
    }

    #[test]
    fn test_parse_azure_resource_group() {
        let id = "/subscriptions/sub-1/resourceGroups/MyGroup/providers/Microsoft.Compute/virtualMachines/vm1";
        assert_eq!(parse_azure_resource_group(id), "MyGroup");
        assert_eq!(parse_azure_resource_group("/subscriptions/sub-1/providers/x"), "");
    }

    #[test]
    fn test_parse_arm_vm_json() {
        let payload = json!({
            "value": [
                {
                    "id": "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/web-01",
                    "name": "web-01",
                    "properties": {
                        "hardwareProfile": { "vmSize": "Standard_D2s_v3" },
                        "storageProfile": {
                            "osDisk": {
                                "name": "web-01_OsDisk_1",
                                "osType": "Linux",
                                "diskSizeGB": 30,
                                "managedDisk": {
                                    "id": "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/web-01_OsDisk_1",
                                    "storageAccountType": "Premium_LRS"
                                }
                            },
                            "dataDisks": [
                                {
                                    "name": "web-01-data-1",
                                    "lun": 0,
                                    "diskSizeGB": 128,
                                    "managedDisk": {
                                        "id": "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/web-01-data-1",
                                        "storageAccountType": "StandardSSD_LRS"
                                    }
                                }
                            ]
                        }
                    }
                }
            ]
        });
        let vms = parse_arm_vm_json(&payload).unwrap();
        assert_eq!(vms.len(), 1);
        let vm = &vms[0];
        assert_eq!(vm.name, "web-01");
        assert_eq!(vm.resource_group, "rg-prod");
        assert_eq!(vm.vm_size, "Standard_D2s_v3");
        assert_eq!(vm.os_type, "Linux");
        assert_eq!(vm.disks.len(), 2);
        assert_eq!(vm.disks[0].name, "web-01_OsDisk_1");
        assert_eq!(vm.disks[0].sku, "Premium_LRS");
        assert_eq!(vm.disks[0].lun, 0);
        assert_eq!(vm.disks[1].name, "web-01-data-1");
        assert_eq!(vm.disks[1].size_gb, 128);
        assert_eq!(vm.disks[1].sku, "StandardSSD_LRS");
        assert_eq!(vm.disks[1].lun, 0);
    }

    #[test]
    fn test_parse_arm_vm_json_empty() {
        let vms = parse_arm_vm_json(&json!({ "value": [] })).unwrap();
        assert!(vms.is_empty());
        let vms = parse_arm_vm_json(&json!({})).unwrap();
        assert!(vms.is_empty());
    }
}
