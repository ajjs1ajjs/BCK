use anyhow::Result;
use async_trait::async_trait;
use azure_storage::StorageCredentials;
use azure_storage_blobs::container::operations::BlobItem;
use azure_storage_blobs::prelude::*;
use futures::StreamExt;
use sha2::{Digest, Sha256};

use super::{StorageBackend, StorageStats};

pub struct AzureBlobStorage {
    container: ContainerClient,
    container_name: String,
}

impl AzureBlobStorage {
    pub async fn new(
        account: &str,
        access_key: &str,
        container: &str,
        connection_string: Option<&str>,
    ) -> Result<Self> {
        let credentials = match connection_string {
            Some(_cs) => {
                // Fall back to access key; connection-string account parsing is
                // handled by callers passing account + key explicitly.
                StorageCredentials::access_key(account.to_string(), access_key.to_string())
            }
            None => StorageCredentials::access_key(account.to_string(), access_key.to_string()),
        };

        let client = ClientBuilder::new(account.to_string(), credentials)
            .container_client(container.to_string());

        let backend = Self {
            container: client,
            container_name: container.to_string(),
        };

        // Ensure the container exists.
        let exists = backend
            .container
            .get_properties()
            .await
            .map(|_| true)
            .unwrap_or(false);

        if !exists {
            backend.container.create().await?;
        }

        Ok(backend)
    }

    fn blob_name(&self, id: &str) -> String {
        let hash = Sha256::digest(id.as_bytes());
        let hex = hex::encode(hash);
        format!("b/{}/{}/{}", &hex[..2], &hex[2..4], &hex)
    }
}

#[async_trait]
impl StorageBackend for AzureBlobStorage {
    async fn write_block(&self, id: &str, data: &[u8]) -> Result<()> {
        let name = self.blob_name(id);
        self.container
            .blob_client(name)
            .put_block_blob(data.to_vec())
            .await?;
        Ok(())
    }

    async fn read_block(&self, id: &str) -> Result<Vec<u8>> {
        let name = self.blob_name(id);
        let mut stream = self.container.blob_client(name).get().into_stream();
        let mut result: Vec<u8> = Vec::new();
        while let Some(page) = stream.next().await {
            let page = page?;
            let body = page.data.collect().await?;
            result.extend_from_slice(&body);
        }
        Ok(result)
    }

    async fn delete_block(&self, id: &str) -> Result<()> {
        let name = self.blob_name(id);
        self.container.blob_client(name).delete().await?;
        Ok(())
    }

    async fn exists(&self, id: &str) -> Result<bool> {
        let name = self.blob_name(id);
        let result = self.container.blob_client(name).get_properties().await;
        Ok(result.is_ok())
    }

    async fn list_blocks(&self, prefix: &str) -> Result<Vec<String>> {
        let full_prefix = format!("b/{prefix}");
        let mut blocks = Vec::new();
        let mut stream = self.container.list_blobs().prefix(full_prefix).into_stream();
        while let Some(page) = stream.next().await {
            let page = page?;
            for item in page.blobs.items.iter() {
                if let BlobItem::Blob(blob) = item {
                    blocks.push(blob.name.clone());
                }
            }
        }
        Ok(blocks)
    }

    async fn stats(&self) -> Result<StorageStats> {
        let mut total_size = 0u64;
        let mut total_blocks = 0u64;
        let mut stream = self.container.list_blobs().into_stream();
        while let Some(page) = stream.next().await {
            let page = page?;
            for item in page.blobs.items.iter() {
                if let BlobItem::Blob(blob) = item {
                    total_size += blob.properties.content_length;
                    total_blocks += 1;
                }
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
        self.container.get_properties().await?;
        Ok(())
    }

    fn name(&self) -> &str {
        &self.container_name
    }

    fn backend_type(&self) -> &'static str {
        "azure"
    }
}
