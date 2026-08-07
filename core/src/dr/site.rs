use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::info;

/// Site connector for DR operations.
pub struct SiteConnector;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteConfig {
    pub id: String,
    pub name: String,
    pub site_type: String,
    pub endpoint: String,
    pub api_key: String,
    pub bandwidth_limit_mbps: u64,
}

impl SiteConnector {
    pub fn new() -> Self {
        Self
    }

    /// Test connectivity to a DR site by performing an HTTP GET against
    /// `{endpoint}/api/v1/health` (the endpoint itself when it already ends
    /// with a health path), with a 5s timeout.
    pub async fn test_connection(&self, endpoint: &str) -> Result<bool> {
        let endpoint = normalize_endpoint(endpoint);
        let health_url = if endpoint.ends_with("/api/v1/health") {
            endpoint
        } else {
            format!("{}/api/v1/health", endpoint.trim_end_matches('/'))
        };
        info!("Testing DR site connection: {}", health_url);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| anyhow!("Failed to build HTTP client: {}", e))?;

        let resp = client
            .get(&health_url)
            .send()
            .await
            .map_err(|e| anyhow!("DR site health check failed: {}", e))?;

        if resp.status().is_success() {
            info!("DR site {} reachable: {}", health_url, resp.status());
            Ok(true)
        } else {
            info!("DR site {} responded with status {}", health_url, resp.status());
            Ok(false)
        }
    }

    /// Synchronize site configuration.
    ///
    /// Kept minimal: config sync is out of scope for a site endpoint in this
    /// crate.
    pub async fn sync_config(&self, site_id: &str) -> Result<()> {
        info!("Syncing DR site configuration: {}", site_id);
        Ok(())
    }
}

/// Normalize a site endpoint: prepend `http://` when no scheme is present and
/// trim any trailing `/`.
pub fn normalize_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_endpoint_adds_http_scheme() {
        assert_eq!(normalize_endpoint("dr.example.com"), "http://dr.example.com");
    }

    #[test]
    fn normalize_endpoint_preserves_scheme() {
        assert_eq!(
            normalize_endpoint("https://dr.example.com"),
            "https://dr.example.com"
        );
    }

    #[test]
    fn normalize_endpoint_trims_trailing_slash() {
        assert_eq!(normalize_endpoint("dr.example.com/"), "http://dr.example.com");
        assert_eq!(
            normalize_endpoint("https://dr.example.com///"),
            "https://dr.example.com"
        );
    }
}
