use anyhow::Result;
use async_trait::async_trait;

use super::{s3::S3Storage, StorageBackend, StorageStats};

/// Google Cloud Storage backend implemented over the S3-compatible
/// interop endpoint (HMAC credentials). GCS officially supports the
/// S3 XML API via `https://storage.googleapis.com`.
pub struct GcsStorage {
    inner: S3Storage,
}

impl GcsStorage {
    pub async fn new(
        bucket: &str,
        region: &str,
        access_key: Option<&str>,
        secret_key: Option<&str>,
    ) -> Result<Self> {
        let region = if region.is_empty() { "auto" } else { region };
        let inner = S3Storage::new(
            bucket,
            region,
            Some("https://storage.googleapis.com"),
            access_key,
            secret_key,
        )
        .await?;
        Ok(Self { inner })
    }
}

#[async_trait]
impl StorageBackend for GcsStorage {
    async fn write_block(&self, id: &str, data: &[u8]) -> Result<()> {
        self.inner.write_block(id, data).await
    }

    async fn read_block(&self, id: &str) -> Result<Vec<u8>> {
        self.inner.read_block(id).await
    }

    async fn delete_block(&self, id: &str) -> Result<()> {
        self.inner.delete_block(id).await
    }

    async fn exists(&self, id: &str) -> Result<bool> {
        self.inner.exists(id).await
    }

    async fn list_blocks(&self, prefix: &str) -> Result<Vec<String>> {
        self.inner.list_blocks(prefix).await
    }

    async fn stats(&self) -> Result<StorageStats> {
        self.inner.stats().await
    }

    async fn test_connection(&self) -> Result<()> {
        self.inner.test_connection().await
    }

    fn name(&self) -> &str {
        self.inner.name()
    }

    fn backend_type(&self) -> &'static str {
        "gcs"
    }
}
