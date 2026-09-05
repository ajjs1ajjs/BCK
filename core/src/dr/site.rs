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
        validate_endpoint(&endpoint)?;
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

/// Normalize a site endpoint: prepend `https://` when no scheme is present and
/// trim any trailing `/`.
pub fn normalize_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

/// Reject DR-site endpoints that would let the daemon be used for SSRF:
/// loopback / link-local / metadata / unspecified addresses, or non-http(s)
/// schemes. RFC1918 private ranges stay allowed (a DR site commonly lives on
/// the LAN).
fn validate_endpoint(endpoint: &str) -> Result<()> {
    let u = reqwest::Url::parse(endpoint)
        .map_err(|_| anyhow!("invalid DR site endpoint: {endpoint}"))?;
    match u.scheme() {
        "http" | "https" => {}
        other => anyhow::bail!("unsupported DR site endpoint scheme: {other}"),
    }
    if let Some(host) = u.host_str() {
        if let Ok(ip) = host.parse::<std::net::IpAddr>() {
            let bad = match ip {
                std::net::IpAddr::V4(v4) => {
                    v4.is_loopback()
                        || v4.is_unspecified()
                        || v4.is_link_local()
                        || v4.is_multicast()
                        || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
                }
                std::net::IpAddr::V6(v6) => {
                    v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() || v6.is_unicast_link_local()
                }
            };
            if bad {
                anyhow::bail!(
                    "DR site endpoint must not point to a loopback/link-local address: {endpoint}"
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_endpoint_adds_https_scheme() {
        assert_eq!(normalize_endpoint("dr.example.com"), "https://dr.example.com");
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
        assert_eq!(normalize_endpoint("dr.example.com/"), "https://dr.example.com");
        assert_eq!(
            normalize_endpoint("https://dr.example.com///"),
            "https://dr.example.com"
        );
    }

    #[test]
    fn validate_endpoint_rejects_metadata_and_loopback() {
        assert!(validate_endpoint("http://169.254.169.254").is_err());
        assert!(validate_endpoint("http://127.0.0.1:9440").is_err());
        assert!(validate_endpoint("gopher://dr.example.com").is_err());
        // Private LAN endpoints are the legitimate DR use case.
        assert!(validate_endpoint("http://192.168.1.20:9440").is_ok());
    }
}
