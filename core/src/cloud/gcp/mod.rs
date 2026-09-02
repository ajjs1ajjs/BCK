pub mod gce;
pub mod disks;
pub mod sql;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::info;

use super::CloudAccount;

const COMPUTE_SCOPE: &str = "https://www.googleapis.com/auth/compute";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

/// GCP connector — manages GCE, Persistent Disk, and Cloud SQL backups
pub struct GcpConnector {
    account: CloudAccount,
    client: reqwest::Client,
    token: RwLock<Option<(String, i64, String)>>,
}

impl GcpConnector {
    pub fn new(account: CloudAccount) -> Self {
        Self {
            account,
            client: reqwest::Client::new(),
            token: RwLock::new(None),
        }
    }

    /// Exchange a service-account JWT for an OAuth2 access token.
    async fn oauth_token(&self) -> Result<(String, i64, String)> {
        gcp_oauth_exchange(&self.client).await
    }

    /// Return a cached (or freshly acquired) access token plus the project id.
    async fn ensure_token(&self) -> Result<(String, String)> {
        {
            let guard = self
                .token
                .read()
                .map_err(|_| anyhow!("gcp token lock poisoned"))?;
            if let Some((tok, exp, project)) = guard.as_ref() {
                if *exp > now_unix() + 60 {
                    return Ok((tok.clone(), project.clone()));
                }
            }
        }
        let (tok, exp, project) = self.oauth_token().await?;
        let mut guard = self
            .token
            .write()
            .map_err(|_| anyhow!("gcp token lock poisoned"))?;
        *guard = Some((tok.clone(), exp, project.clone()));
        Ok((tok, project))
    }

    /// Authenticate with GCP using a service account (RS256 JWT bearer grant).
    pub async fn authenticate(&self) -> Result<GcpSession> {
        info!("Authenticating with GCP: region={}", self.account.region);
        let (access_token, expires_at, project_id) = self.oauth_token().await?;
        let mut guard = self
            .token
            .write()
            .map_err(|_| anyhow!("gcp token lock poisoned"))?;
        *guard = Some((access_token.clone(), expires_at, project_id.clone()));
        Ok(GcpSession {
            project_id,
            region: self.account.region.clone(),
            access_token,
            expires_at,
        })
    }

    /// List all GCE instances across all zones (aggregated list).
    pub async fn list_instances(&self) -> Result<Vec<GceInstance>> {
        let (token, project_id) = self.ensure_token().await?;
        let url = format!(
            "https://compute.googleapis.com/compute/v1/projects/{project_id}/aggregated/instances?alt=json"
        );
        let resp = self.client.get(&url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GCP list instances failed: {status} {body}");
        }
        let json: Value = serde_json::from_str(&body)?;
        parse_gce_json(&json)
    }
}

pub struct GcpSession {
    pub project_id: String,
    pub region: String,
    pub access_token: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GceInstance {
    pub id: String,
    pub name: String,
    pub zone: String,
    pub machine_type: String,
    pub disks: Vec<String>,
}

#[derive(Serialize)]
struct GcpJwtClaims {
    iss: String,
    scope: String,
    aud: String,
    iat: i64,
    exp: i64,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Acquire a GCP OAuth2 bearer token using the service account in
/// GOOGLE_APPLICATION_CREDENTIALS.
pub(crate) async fn gcp_bearer_token(client: &reqwest::Client) -> Result<String> {
    let (token, _expires_at, _project_id) = gcp_oauth_exchange(client).await?;
    Ok(token)
}

/// Exchange a service-account JWT for an OAuth2 access token.
async fn gcp_oauth_exchange(client: &reqwest::Client) -> Result<(String, i64, String)> {
    let creds_path = std::env::var("GOOGLE_APPLICATION_CREDENTIALS")
        .map_err(|_| anyhow!("GOOGLE_APPLICATION_CREDENTIALS not set"))?;
    let raw = std::fs::read_to_string(&creds_path)
        .map_err(|e| anyhow!("failed to read service account file {creds_path}: {e}"))?;
    let creds: Value = serde_json::from_str(&raw)?;
    let private_key = creds["private_key"]
        .as_str()
        .ok_or_else(|| anyhow!("service account JSON missing private_key"))?;
    let client_email = creds["client_email"]
        .as_str()
        .ok_or_else(|| anyhow!("service account JSON missing client_email"))?;
    let project_id = creds["project_id"]
        .as_str()
        .ok_or_else(|| anyhow!("service account JSON missing project_id"))?;

    let now = now_unix();
    let claims = GcpJwtClaims {
        iss: client_email.to_string(),
        scope: COMPUTE_SCOPE.to_string(),
        aud: TOKEN_URL.to_string(),
        iat: now,
        exp: now + 3600,
    };
    let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    let pem_data = pem::parse(private_key.as_bytes())
        .map_err(|e| anyhow!("failed to parse RSA private key PEM: {}", e))?;
    let key = jsonwebtoken::EncodingKey::from_rsa_der(pem_data.contents());
    let jwt = jsonwebtoken::encode(&header, &claims, &key)?;

    let form = [
        ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
        ("assertion", jwt.as_str()),
    ];
    let resp = client.post(TOKEN_URL).form(&form).send().await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        anyhow::bail!("GCP OAuth2 token request failed: {status} {body}");
    }
    let v: Value = serde_json::from_str(&body)?;
    let access_token = v["access_token"]
        .as_str()
        .ok_or_else(|| anyhow!("GCP token response missing access_token"))?
        .to_string();
    let expires_in = v["expires_in"].as_u64().unwrap_or(3600);
    Ok((access_token, now + expires_in as i64, project_id.to_string()))
}

/// Read the GCP project id from GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT.
pub(crate) fn project_id_from_env() -> Result<String> {
    std::env::var("GOOGLE_CLOUD_PROJECT")
        .or_else(|_| std::env::var("GCLOUD_PROJECT"))
        .map_err(|_| anyhow!("GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT not set"))
}

/// Poll a Compute Engine / Cloud SQL operation until `status == "DONE"`.
pub(crate) async fn poll_gcp_operation(
    client: &reqwest::Client,
    operation_url: &str,
    token: &str,
    what: &str,
    timeout_secs: u64,
    interval_secs: u64,
) -> Result<Value> {
    let deadline = SystemTime::now() + Duration::from_secs(timeout_secs);
    loop {
        let resp = client.get(operation_url).bearer_auth(token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GCP GET {what} operation failed: {status} {text}");
        }
        let v: Value = serde_json::from_str(&text)?;
        let op_status = v["status"].as_str().unwrap_or("Unknown");
        info!("{what} operation status={op_status}");
        if op_status == "DONE" {
            if let Some(err) = v.get("error") {
                anyhow::bail!("GCP {what} operation failed: {err}");
            }
            return Ok(v);
        }
        if SystemTime::now() > deadline {
            anyhow::bail!("GCP {what} operation timed out waiting for completion");
        }
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;
    }
}

/// Extract the zone name from an aggregated-list key such as `zones/us-central1-a`.
fn zone_from_key(key: &str) -> Option<&str> {
    let zone = key.rsplit('/').next()?;
    if zone.is_empty() {
        None
    } else {
        Some(zone)
    }
}

/// Parse the Compute Engine aggregated `instances` list response into `GceInstance`s.
fn parse_gce_json(json: &Value) -> Result<Vec<GceInstance>> {
    let mut instances = Vec::new();
    let Some(items) = json.get("items").and_then(|i| i.as_object()) else {
        return Ok(instances);
    };
    for (zone_key, zone_value) in items {
        let Some(zone) = zone_from_key(zone_key) else {
            continue;
        };
        let Some(insts) = zone_value.get("instances").and_then(|i| i.as_array()) else {
            continue;
        };
        for inst in insts {
            let id = inst["id"]
                .as_u64()
                .map(|n| n.to_string())
                .unwrap_or_default();
            let name = inst["name"].as_str().unwrap_or("").to_string();
            let machine_type = inst["machineType"]
                .as_str()
                .map(|m| m.rsplit('/').next().unwrap_or("").to_string())
                .unwrap_or_default();
            let mut disks = Vec::new();
            if let Some(ds) = inst.get("disks").and_then(|d| d.as_array()) {
                for d in ds {
                    if let Some(src) = d["source"].as_str() {
                        disks.push(src.rsplit('/').next().unwrap_or(src).to_string());
                    }
                }
            }
            instances.push(GceInstance {
                id,
                name,
                zone: zone.to_string(),
                machine_type,
                disks,
            });
        }
    }
    Ok(instances)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_zone_from_key() {
        assert_eq!(zone_from_key("zones/us-central1-a"), Some("us-central1-a"));
        assert_eq!(zone_from_key("us-central1-a"), Some("us-central1-a"));
        assert_eq!(zone_from_key("zones/"), None);
        assert_eq!(zone_from_key(""), None);
    }

    #[test]
    fn test_parse_gce_json() {
        let payload = json!({
            "items": {
                "zones/us-central1-a": {
                    "instances": [
                        {
                            "id": 123456789,
                            "name": "web-01",
                            "machineType": "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/machineTypes/e2-medium",
                            "disks": [
                                {
                                    "source": "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/disks/web-01-boot"
                                },
                                {
                                    "source": "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/disks/web-01-data"
                                }
                            ]
                        }
                    ]
                },
                "zones/europe-west1-b": {
                    "instances": [
                        {
                            "id": 987654321,
                            "name": "worker-02",
                            "machineType": "https://www.googleapis.com/compute/v1/projects/p/zones/europe-west1-b/machineTypes/n2-standard-2"
                        }
                    ]
                },
                "zones/us-central1-a/warnings": {
                    "warning": []
                }
            }
        });
        let instances = parse_gce_json(&payload).unwrap();
        assert_eq!(instances.len(), 2);
        let web = instances.iter().find(|i| i.name == "web-01").expect("web-01 present");
        assert_eq!(web.id, "123456789");
        assert_eq!(web.zone, "us-central1-a");
        assert_eq!(web.machine_type, "e2-medium");
        assert_eq!(
            web.disks,
            vec!["web-01-boot".to_string(), "web-01-data".to_string()]
        );
        let worker = instances.iter().find(|i| i.name == "worker-02").expect("worker-02 present");
        assert_eq!(worker.zone, "europe-west1-b");
        assert_eq!(worker.machine_type, "n2-standard-2");
        assert!(worker.disks.is_empty());
    }

    #[test]
    fn test_parse_gce_json_empty() {
        assert!(parse_gce_json(&json!({})).unwrap().is_empty());
        assert!(parse_gce_json(&json!({ "items": {} })).unwrap().is_empty());
    }
}
