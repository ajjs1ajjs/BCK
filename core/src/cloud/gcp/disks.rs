use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tracing::info;

use super::{gcp_bearer_token, poll_gcp_operation, project_id_from_env};

const OPERATION_TIMEOUT_SECS: u64 = 60;
const OPERATION_INTERVAL_SECS: u64 = 5;

/// GCP persistent disk snapshot management.
pub struct GcpDiskBackup {
    client: reqwest::Client,
    project_id: String,
    zone: String,
}

impl GcpDiskBackup {
    pub fn new(project_id: String, zone: String) -> Self {
        Self::new_with(project_id, zone)
    }

    pub fn new_with(project_id: String, zone: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            project_id,
            zone,
        }
    }

    /// Construct from GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT and GCP_ZONE env vars.
    pub fn new_from_env() -> Result<Self> {
        let project_id = project_id_from_env()?;
        let zone = std::env::var("GCP_ZONE").map_err(|_| anyhow!("GCP_ZONE not set"))?;
        Ok(Self::new_with(project_id, zone))
    }

    async fn token(&self) -> Result<String> {
        gcp_bearer_token(&self.client).await
    }

    /// Create a snapshot of a persistent disk. Returns the snapshot name.
    pub async fn create_snapshot(&self, disk: &str, name: &str) -> Result<String> {
        let token = self.token().await?;
        let url = format!(
            "https://compute.googleapis.com/compute/v1/projects/{}/zones/{}/disks/{disk}/createSnapshot?alt=json",
            self.project_id, self.zone
        );
        let body = json!({ "name": name });
        info!("Creating GCP disk snapshot: {disk} -> {name}");
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GCP create snapshot failed: {status} {text}");
        }
        let op: Value = serde_json::from_str(&text)?;
        self.poll_operation(&token, &op, "snapshot").await?;
        Ok(name.to_string())
    }

    /// Create a new disk restored from a snapshot. Returns the new disk name.
    pub async fn restore_disk(&self, snapshot: &str, new_disk: &str) -> Result<String> {
        let token = self.token().await?;
        let url = format!(
            "https://compute.googleapis.com/compute/v1/projects/{}/zones/{}/disks?alt=json",
            self.project_id, self.zone
        );
        let source_snapshot = format!("projects/{}/global/snapshots/{snapshot}", self.project_id);
        let body = json!({
            "name": new_disk,
            "sourceSnapshot": source_snapshot
        });
        info!("Restoring GCP disk {new_disk} from snapshot {snapshot}");
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GCP create disk failed: {status} {text}");
        }
        let op: Value = serde_json::from_str(&text)?;
        self.poll_operation(&token, &op, "disk").await?;
        Ok(new_disk.to_string())
    }

    /// List all snapshot names in the project.
    pub async fn list_snapshots(&self) -> Result<Vec<String>> {
        let token = self.token().await?;
        let url = format!(
            "https://compute.googleapis.com/compute/v1/projects/{}/global/snapshots?alt=json",
            self.project_id
        );
        let resp = self.client.get(&url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GCP list snapshots failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        Ok(parse_snapshot_names(&json))
    }

    async fn poll_operation(&self, token: &str, op: &Value, what: &str) -> Result<Value> {
        let op_url = op["selfLink"].as_str().map(|s| s.to_string()).unwrap_or_else(|| {
            format!(
                "https://compute.googleapis.com/compute/v1/projects/{}/zones/{}/operations/{}",
                self.project_id,
                self.zone,
                op["name"].as_str().unwrap_or("")
            )
        });
        poll_gcp_operation(
            &self.client,
            &op_url,
            token,
            what,
            OPERATION_TIMEOUT_SECS,
            OPERATION_INTERVAL_SECS,
        )
        .await
    }
}

/// Parse the Compute Engine `snapshots` list response into snapshot names.
fn parse_snapshot_names(json: &Value) -> Vec<String> {
    let mut names = Vec::new();
    let Some(items) = json.get("items").and_then(|i| i.as_array()) else {
        return names;
    };
    for item in items {
        if let Some(n) = item["name"].as_str() {
            names.push(n.to_string());
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_snapshot_names() {
        let payload = json!({
            "kind": "compute#snapshotList",
            "items": [
                { "name": "bck-web-01-snap-20260806", "status": "READY" },
                { "name": "bck-web-01-snap-20260805", "status": "READY" }
            ]
        });
        assert_eq!(
            parse_snapshot_names(&payload),
            vec![
                "bck-web-01-snap-20260806".to_string(),
                "bck-web-01-snap-20260805".to_string()
            ]
        );
    }

    #[test]
    fn test_parse_snapshot_names_empty() {
        assert!(parse_snapshot_names(&json!({ "items": [] })).is_empty());
        assert!(parse_snapshot_names(&json!({})).is_empty());
    }
}
