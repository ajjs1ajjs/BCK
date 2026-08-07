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
