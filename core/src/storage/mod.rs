pub mod local;
pub mod s3;
pub mod azure;
pub mod gcs;

use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;

#[async_trait]
pub trait StorageBackend: Send + Sync {
    async fn write_block(&self, id: &str, data: &[u8]) -> Result<()>;
    async fn read_block(&self, id: &str) -> Result<Vec<u8>>;
    async fn delete_block(&self, id: &str) -> Result<()>;
    async fn exists(&self, id: &str) -> Result<bool>;
    async fn list_blocks(&self, prefix: &str) -> Result<Vec<String>>;
    async fn stats(&self) -> Result<StorageStats>;
    async fn test_connection(&self) -> Result<()>;
    fn name(&self) -> &str;
    fn backend_type(&self) -> &'static str;
}

#[derive(Debug, Clone)]
pub struct StorageStats {
    pub capacity_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub total_blocks: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct StorageConfig {
    pub backend_type: String,
    pub path: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
    pub container: Option<String>,
    pub connection_string: Option<String>,
    pub account: Option<String>,
}

pub async fn create_backend(config: StorageConfig) -> Result<Box<dyn StorageBackend>> {
    // Custom object-storage endpoints are validated to stop the daemon being
    // used to probe internal/cloud-metadata hosts (SSRF).
    if let Some(endpoint) = &config.endpoint {
        validate_storage_endpoint(endpoint)?;
    }
    match config.backend_type.to_lowercase().as_str() {
        "local" | "filesystem" => {
            let path = config.path.unwrap_or_else(|| "./backup-store".into());
            Ok(Box::new(local::LocalStorage::new(&path)?))
        }
        "s3" => {
            let backend = s3::S3Storage::new(
                &config.bucket.unwrap_or_default(),
                &config.region.unwrap_or_default(),
                config.endpoint.as_deref(),
                config.access_key.as_deref(),
                config.secret_key.as_deref(),
            ).await?;
            Ok(Box::new(backend))
        }
        "azure" => {
            let account = config.account.clone()
                .or_else(|| config.bucket.clone())
                .ok_or_else(|| anyhow::anyhow!("Azure storage requires an account name"))?;
            let key = config.secret_key.as_deref()
                .or_else(|| config.access_key.as_deref())
                .ok_or_else(|| anyhow::anyhow!("Azure storage requires an access key"))?;
            let container = config.container.clone()
                .unwrap_or_else(|| "bck".into());
            let backend = azure::AzureBlobStorage::new(
                &account,
                key,
                &container,
                config.connection_string.as_deref(),
            ).await?;
            Ok(Box::new(backend))
        }
        "gcs" | "google" | "google-cloud" => {
            let bucket = config.bucket.ok_or_else(|| anyhow::anyhow!("GCS storage requires a bucket"))?;
            let region = config.region.clone().unwrap_or_else(|| "auto".into());
            let backend = gcs::GcsStorage::new(
                &bucket,
                &region,
                config.access_key.as_deref(),
                config.secret_key.as_deref(),
            ).await?;
            Ok(Box::new(backend))
        }
        _ => anyhow::bail!("Unsupported storage backend: {}", config.backend_type),
    }
}

/// Validate a custom object-storage endpoint (S3-compatible etc.). Only
/// http/https are accepted and link-local/metadata/unspecified addresses are
/// rejected so the daemon cannot be pointed at internal or cloud-metadata
/// hosts (SSRF). Loopback and RFC1918 private addresses stay allowed for local
/// dev / on-premise object storage.
pub fn validate_storage_endpoint(endpoint: &str) -> Result<()> {
    let u = reqwest::Url::parse(endpoint)
        .map_err(|_| anyhow::anyhow!("invalid storage endpoint: {endpoint}"))?;
    match u.scheme() {
        "http" | "https" => {}
        other => anyhow::bail!("unsupported storage endpoint scheme: {other}"),
    }
    if let Some(host) = u.host_str() {
        if let Ok(ip) = host.parse::<std::net::IpAddr>() {
            let bad = match ip {
                std::net::IpAddr::V4(v4) => {
                    v4.is_unspecified()
                        || v4.is_link_local()
                        || v4.is_multicast()
                        || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
                }
                std::net::IpAddr::V6(v6) => {
                    v6.is_unspecified() || v6.is_multicast() || v6.is_unicast_link_local()
                }
            };
            if bad {
                anyhow::bail!(
                    "storage endpoint must not point to a link-local/metadata address: {endpoint}"
                );
            }
        }
    }
    Ok(())
}
