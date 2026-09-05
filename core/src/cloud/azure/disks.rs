use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tracing::info;

use super::{azure_bearer_token, poll_azure_resource};

const API_VERSION: &str = "2023-07-01";
const OAUTH_SCOPE: &str = "https://management.azure.com/.default";
const POLL_TIMEOUT_SECS: u64 = 60;
const POLL_INTERVAL_SECS: u64 = 5;

/// Azure managed disk snapshot management.
pub struct AzureDiskBackup {
    client: reqwest::Client,
    subscription_id: String,
    resource_group: String,
    tenant_id: String,
    client_id: String,
    client_secret: String,
}

impl AzureDiskBackup {
    /// Construct from explicit Azure credential values.
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
        }
    }

    /// Construct from the AZURE_* environment variables.
    pub fn new_from_env() -> Result<Self> {
        let subscription_id = std::env::var("AZURE_SUBSCRIPTION_ID")
            .map_err(|_| anyhow!("AZURE_SUBSCRIPTION_ID not set"))?;
        let resource_group = std::env::var("AZURE_RESOURCE_GROUP")
            .map_err(|_| anyhow!("AZURE_RESOURCE_GROUP not set"))?;
        let tenant_id =
            std::env::var("AZURE_TENANT_ID").map_err(|_| anyhow!("AZURE_TENANT_ID not set"))?;
        let client_id =
            std::env::var("AZURE_CLIENT_ID").map_err(|_| anyhow!("AZURE_CLIENT_ID not set"))?;
        let client_secret = std::env::var("AZURE_CLIENT_SECRET")
            .map_err(|_| anyhow!("AZURE_CLIENT_SECRET not set"))?;
        Ok(Self::new(
            subscription_id,
            resource_group,
            tenant_id,
            client_id,
            client_secret,
        ))
    }

    async fn token(&self) -> Result<String> {
        azure_bearer_token(
            &self.client,
            &self.tenant_id,
            &self.client_id,
            &self.client_secret,
            OAUTH_SCOPE,
        )
        .await
    }

    fn snapshots_url(&self) -> String {
        format!(
            "https://management.azure.com/subscriptions/{}/resourceGroups/{}/providers/Microsoft.Compute/snapshots",
            self.subscription_id, self.resource_group
        )
    }

    fn disks_url(&self) -> String {
        format!(
            "https://management.azure.com/subscriptions/{}/resourceGroups/{}/providers/Microsoft.Compute/disks",
            self.subscription_id, self.resource_group
        )
    }

    /// Create a full-copy snapshot of a managed disk. Returns the snapshot resource id.
    pub async fn create_snapshot(&self, disk_id: &str, name: &str) -> Result<String> {
        let token = self.token().await?;
        let location = self.resource_location(&token, disk_id).await?;

        let url = format!("{}/{}?api-version={API_VERSION}", self.snapshots_url(), name);
        let body = json!({
            "location": location,
            "properties": {
                "creationData": {
                    "createOption": "Copy",
                    "sourceResourceId": disk_id
                }
            }
        });
        info!("Creating Azure disk snapshot: {disk_id} -> {name}");
        let resp = self
            .client
            .put(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure create snapshot failed: {status} {text}");
        }
        let snapshot = poll_azure_resource(
            &self.client,
            &url,
            &token,
            "snapshot",
            POLL_TIMEOUT_SECS,
            POLL_INTERVAL_SECS,
        )
        .await?;
        let id = snapshot["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| url.split('?').next().unwrap_or(&url).to_string());
        Ok(id)
    }

    /// Create a new managed disk copied from a snapshot. Returns the new disk resource id.
    pub async fn restore_volume(&self, snapshot_id: &str, disk_name: &str) -> Result<String> {
        let token = self.token().await?;
        let location = self.resource_location(&token, snapshot_id).await?;

        let url = format!("{}/{disk_name}?api-version={API_VERSION}", self.disks_url());
        let body = json!({
            "location": location,
            "properties": {
                "creationData": {
                    "createOption": "Copy",
                    "sourceResourceId": snapshot_id
                }
            }
        });
        info!("Restoring Azure disk {disk_name} from snapshot {snapshot_id}");
        let resp = self
            .client
            .put(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure restore disk failed: {status} {text}");
        }
        let disk = poll_azure_resource(
            &self.client,
            &url,
            &token,
            "disk",
            POLL_TIMEOUT_SECS,
            POLL_INTERVAL_SECS,
        )
        .await?;
        let id = disk["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| url.split('?').next().unwrap_or(&url).to_string());
        Ok(id)
    }

    /// List snapshot names in the resource group whose source is the given disk id.
    pub async fn list_snapshots(&self, disk_id: &str) -> Result<Vec<String>> {
        let token = self.token().await?;
        let url = format!("{}?api-version={API_VERSION}", self.snapshots_url());
        let resp = self.client.get(&url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure list snapshots failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        Ok(parse_snapshot_names(&json, disk_id))
    }

    /// Delete a snapshot given its resource id or plain name.
    pub async fn delete_snapshot(&self, snapshot_id: &str) -> Result<()> {
        let token = self.token().await?;
        let name = resource_name(snapshot_id);
        let rg = resource_group_from_id(snapshot_id).unwrap_or(self.resource_group.as_str());
        let url = format!(
            "https://management.azure.com/subscriptions/{}/resourceGroups/{rg}/providers/Microsoft.Compute/snapshots/{name}?api-version={API_VERSION}",
            self.subscription_id
        );
        info!("Deleting Azure snapshot: {name}");
        let resp = self
            .client
            .delete(&url)
            .bearer_auth(&token)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure delete snapshot failed: {status} {text}");
        }
        Ok(())
    }

    /// GET an ARM resource and return its `location`.
    async fn resource_location(&self, token: &str, resource_id: &str) -> Result<String> {
        let url = format!("{resource_id}?api-version={API_VERSION}");
        let resp = self.client.get(&url).bearer_auth(token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure GET resource failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        json["location"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("Azure resource {resource_id} has no location"))
    }
}

/// Parse the ARM `snapshots` list response, returning the names of snapshots
/// whose `properties.creationData.sourceResourceId` equals `disk_id`.
fn parse_snapshot_names(json: &Value, disk_id: &str) -> Vec<String> {
    let mut names = Vec::new();
    let Some(items) = json.get("value").and_then(|v| v.as_array()) else {
        return names;
    };
    for item in items {
        let source = item["properties"]["creationData"]["sourceResourceId"]
            .as_str()
            .unwrap_or("");
        if source == disk_id {
            if let Some(n) = item["name"].as_str() {
                names.push(n.to_string());
            }
        }
    }
    names
}

/// Last path segment of an ARM resource id (the resource name).
fn resource_name(resource_id: &str) -> &str {
    resource_id
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
}

/// The resource group name embedded in an ARM resource id.
fn resource_group_from_id(resource_id: &str) -> Option<&str> {
    let parts: Vec<&str> = resource_id.split('/').collect();
    for (i, part) in parts.iter().enumerate() {
        if *part == "resourceGroups" {
            return parts.get(i + 1).copied();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_snapshot_names_filters_by_source() {
        let disk_id = "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/web-01_OsDisk_1";
        let payload = json!({
            "value": [
                {
                    "name": "bck-web-01-os-1",
                    "properties": {
                        "creationData": {
                            "createOption": "Copy",
                            "sourceResourceId": disk_id
                        }
                    }
                },
                {
                    "name": "bck-web-01-os-2",
                    "properties": {
                        "creationData": {
                            "createOption": "Copy",
                            "sourceResourceId": disk_id
                        }
                    }
                },
                {
                    "name": "bck-web-01-data-1",
                    "properties": {
                        "creationData": {
                            "createOption": "Copy",
                            "sourceResourceId": "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/web-01-data-1"
                        }
                    }
                },
                {
                    "name": "manual-snapshot",
                    "properties": {
                        "creationData": { "createOption": "Empty" }
                    }
                }
            ]
        });
        let names = parse_snapshot_names(&payload, disk_id);
        assert_eq!(
            names,
            vec!["bck-web-01-os-1".to_string(), "bck-web-01-os-2".to_string()]
        );
    }

    #[test]
    fn test_parse_snapshot_names_empty() {
        assert!(parse_snapshot_names(&json!({ "value": [] }), "disk-1").is_empty());
        assert!(parse_snapshot_names(&json!({}), "disk-1").is_empty());
    }

    #[test]
    fn test_resource_name() {
        assert_eq!(
            resource_name("/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/snapshots/bck-001"),
            "bck-001"
        );
        assert_eq!(resource_name("bck-001"), "bck-001");
        assert_eq!(resource_name("/subscriptions/s/"), "s");
    }

    #[test]
    fn test_resource_group_from_id() {
        let id = "/subscriptions/sub-1/resourceGroups/MyGroup/providers/Microsoft.Compute/snapshots/bck-001";
        assert_eq!(resource_group_from_id(id), Some("MyGroup"));
        assert_eq!(resource_group_from_id("plain-name"), None);
    }
}
