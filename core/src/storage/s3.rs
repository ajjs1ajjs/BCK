use anyhow::Result;
use async_trait::async_trait;
use aws_sdk_s3::{
    config::{Credentials, Region},
    primitives::ByteStream,
    Client,
};
use sha2::{Digest, Sha256};

use super::{StorageBackend, StorageStats};

pub struct S3Storage {
    client: Client,
    bucket: String,
    prefix: String,
    /// WORM retention days for Object Lock (COMPLIANCE mode). None = disabled.
    object_lock_days: Option<u32>,
}

impl S3Storage {
    pub async fn new(
        bucket: &str,
        region: &str,
        endpoint: Option<&str>,
        access_key: Option<&str>,
        secret_key: Option<&str>,
    ) -> Result<Self> {
        Self::new_with_lock(bucket, region, endpoint, access_key, secret_key, None).await
    }

    pub async fn new_with_lock(
        bucket: &str,
        region: &str,
        endpoint: Option<&str>,
        access_key: Option<&str>,
        secret_key: Option<&str>,
        object_lock_days: Option<u32>,
    ) -> Result<Self> {
        let mut config_builder = aws_sdk_s3::Config::builder()
            .region(Region::new(region.to_string()));

        if let Some(ep) = endpoint {
            config_builder = config_builder.endpoint_url(ep);
        }

        if let (Some(ak), Some(sk)) = (access_key, secret_key) {
            let creds = Credentials::new(ak, sk, None, None, "bck");
            config_builder = config_builder.credentials_provider(creds);
        }

        // Force path-style for minio/compatible
        config_builder = config_builder.force_path_style(true);

        let client = Client::from_conf(config_builder.build());
        let prefix = String::new();

        Ok(Self { client, bucket: bucket.to_string(), prefix, object_lock_days })
    }

    fn object_key(&self, id: &str) -> String {
        let hash = Sha256::digest(id.as_bytes());
        let hex = hex::encode(hash);
        format!("{}{}/{}/{}", self.prefix, &hex[..2], &hex[2..4], &hex)
    }
}

#[async_trait]
impl StorageBackend for S3Storage {
    async fn write_block(&self, id: &str, data: &[u8]) -> Result<()> {
        let key = self.object_key(id);
        let mut put = self.client
            .put_object()
            .bucket(&self.bucket)
            .key(&key)
            .body(ByteStream::from(data.to_vec()));
        // P1 WORM (10/10): Object Lock COMPLIANCE retention when configured.
        // Bucket must have Object Lock enabled; otherwise S3 rejects with
        // InvalidRequest and the error surfaces (fail-closed, no silent plaintext).
        if let Some(days) = self.object_lock_days {
            if days > 0 {
                let retain_until = (chrono::Utc::now() + chrono::Duration::days(days as i64)).to_rfc3339();
                put = put.object_lock_mode(aws_sdk_s3::types::ObjectLockMode::Compliance)
                    .object_lock_retain_until_date(
                        aws_sdk_s3::primitives::DateTime::from_str(&retain_until, aws_sdk_s3::primitives::DateTimeFormat::DateTime)
                            .map_err(|e| anyhow::anyhow!("object-lock date: {e}"))?,
                    );
            }
        }
        put.send().await?;
        Ok(())
    }

    async fn read_block(&self, id: &str) -> Result<Vec<u8>> {
        let key = self.object_key(id);
        let resp = self.client
            .get_object()
            .bucket(&self.bucket)
            .key(&key)
            .send()
            .await?;

        let data = resp.body.collect().await?.to_vec();
        Ok(data)
    }

    async fn delete_block(&self, id: &str) -> Result<()> {
        let key = self.object_key(id);
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(&key)
            .send()
            .await?;
        Ok(())
    }

    async fn exists(&self, id: &str) -> Result<bool> {
        let key = self.object_key(id);
        let result = self.client
            .head_object()
            .bucket(&self.bucket)
            .key(&key)
            .send()
            .await;
        Ok(result.is_ok())
    }

    async fn list_blocks(&self, prefix: &str) -> Result<Vec<String>> {
        let full_prefix = format!("{}{}", self.prefix, prefix);
        let mut blocks = Vec::new();
        let mut continuation_token: Option<String> = None;

        loop {
            let mut req = self.client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix(&full_prefix);

            if let Some(token) = &continuation_token {
                req = req.continuation_token(token.clone());
            }

            let resp = req.send().await?;

            for obj in resp.contents() {
                if let Some(key) = obj.key() {
                    if let Some(block_id) = key.strip_prefix(&self.prefix) {
                        blocks.push(block_id.to_string());
                    }
                }
            }

            if resp.is_truncated() == Some(true) {
                continuation_token = resp.next_continuation_token().map(|s| s.to_string());
            } else {
                break;
            }
        }

        Ok(blocks)
    }

    async fn stats(&self) -> Result<StorageStats> {
        let mut total_size = 0u64;
        let mut total_blocks = 0u64;

        let mut continuation_token: Option<String> = None;
        loop {
            let mut req = self.client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix(&self.prefix);

            if let Some(token) = &continuation_token {
                req = req.continuation_token(token.clone());
            }

            let resp = req.send().await?;
            for obj in resp.contents() {
                total_size += obj.size().unwrap_or(0) as u64;
                total_blocks += 1;
            }

            if resp.is_truncated() == Some(true) {
                continuation_token = resp.next_continuation_token().map(|s| s.to_string());
            } else {
                break;
            }
        }

        Ok(StorageStats {
            capacity_bytes: 0,
            used_bytes: total_size,
            free_bytes: 0,
            total_blocks,
        })
    }

    async fn test_connection(&self) -> Result<()> {
        self.client
            .head_bucket()
            .bucket(&self.bucket)
            .send()
            .await?;
        Ok(())
    }

    fn name(&self) -> &str {
        &self.bucket
    }

    fn backend_type(&self) -> &'static str {
        "s3"
    }
}
