use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tracing::info;

use super::{gcp_bearer_token, poll_gcp_operation, project_id_from_env};

const OPERATION_TIMEOUT_SECS: u64 = 60;
const OPERATION_INTERVAL_SECS: u64 = 5;

/// GCE instance backup using images.
pub struct GceBackup {
    client: reqwest::Client,
    project_id: String,
    zone: String,
}

impl GceBackup {
    pub fn new(project_id: String, zone: String) -> Self {
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
        Ok(Self::new(project_id, zone))
    }

    async fn token(&self) -> Result<String> {
        gcp_bearer_token(&self.client).await
    }

    /// Create an image of an instance's boot disk (disk name assumed == instance name).
    /// Returns the image name.
    pub async fn create_image(&self, instance: &str, name: &str) -> Result<String> {
        let token = self.token().await?;
        let url = format!(
            "https://compute.googleapis.com/compute/v1/projects/{}/global/images?alt=json",
            self.project_id
        );
        let source_disk = format!("projects/{}/zones/{}/disks/{instance}", self.project_id, self.zone);
        let body = json!({ "name": name, "sourceDisk": source_disk });
        info!("Creating GCE image: {instance} -> {name}");
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
            anyhow::bail!("GCE create image failed: {status} {text}");
        }
        let op: Value = serde_json::from_str(&text)?;
        self.poll_operation(&token, &op, "GCE image").await?;
        Ok(name.to_string())
    }

    /// Create a new instance restored from an image. Returns the new instance name.
    pub async fn restore_from_image(&self, image: &str, name: &str) -> Result<String> {
        let token = self.token().await?;
        let url = format!(
            "https://compute.googleapis.com/compute/v1/projects/{}/zones/{}/instances?alt=json",
            self.project_id, self.zone
        );
        let source_image = format!("projects/{}/global/images/{image}", self.project_id);
        let body = json!({
            "name": name,
            "machineType": format!("zones/{}/machineTypes/n1-standard-1", self.zone),
            "disks": [{
                "boot": true,
                "initializeParams": { "sourceImage": source_image }
            }],
            "networkInterfaces": [{ "network": "global/networks/default" }]
        });
        info!("Restoring GCE instance {name} from image {image}");
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
            anyhow::bail!("GCE create instance failed: {status} {text}");
        }
        let op: Value = serde_json::from_str(&text)?;
        self.poll_operation(&token, &op, "GCE instance").await?;
        Ok(name.to_string())
    }

    /// List image names matching the `bck-` prefix.
    pub async fn list_backups(&self) -> Result<Vec<String>> {
        let token = self.token().await?;
        let url = format!(
            "https://compute.googleapis.com/compute/v1/projects/{}/global/images?alt=json&filter=name%20eq%20bck-%2A",
            self.project_id
        );
        let resp = self.client.get(&url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GCE list images failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        Ok(parse_image_names(&json))
    }

    async fn poll_operation(&self, token: &str, op: &Value, what: &str) -> Result<Value> {
        let op_url = op["selfLink"].as_str().map(|s| s.to_string()).unwrap_or_else(|| {
            format!(
                "https://compute.googleapis.com/compute/v1/projects/{}/global/operations/{}",
                self.project_id,
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

/// Parse the Compute Engine `images` list response into image names.
fn parse_image_names(json: &Value) -> Vec<String> {
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
    fn test_parse_image_names() {
        let payload = json!({
            "kind": "compute#imageList",
            "items": [
                { "name": "bck-web-01-20260806", "status": "READY" },
                { "name": "bck-web-01-20260805", "status": "READY" },
                { "name": "production-image", "status": "READY" }
            ]
        });
        assert_eq!(
            parse_image_names(&payload),
            vec![
                "bck-web-01-20260806".to_string(),
                "bck-web-01-20260805".to_string(),
                "production-image".to_string()
            ]
        );
    }

    #[test]
    fn test_parse_image_names_empty() {
        assert!(parse_image_names(&json!({ "items": [] })).is_empty());
        assert!(parse_image_names(&json!({})).is_empty());
    }
}
