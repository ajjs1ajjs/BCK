use anyhow::Result;
use async_trait::async_trait;

use super::{StorageBackend, StorageStats};

pub struct AzureBlobStorage;

impl AzureBlobStorage {
    pub fn new(_connection_string: &str, _container: &str) -> Result<Self> {
        Ok(Self)
    }
}

#[async_trait]
impl StorageBackend for AzureBlobStorage {
    async fn write_block(&self, _id: &str, _data: &[u8]) -> Result<()> {
        Ok(())
    }
    async fn read_block(&self, _id: &str) -> Result<Vec<u8>> {
        Ok(Vec::new())
    }
    async fn delete_block(&self, _id: &str) -> Result<()> { Ok(()) }
    async fn exists(&self, _id: &str) -> Result<bool> { Ok(false) }
    async fn list_blocks(&self, _prefix: &str) -> Result<Vec<String>> { Ok(Vec::new()) }
    async fn stats(&self) -> Result<StorageStats> {
        Ok(StorageStats { capacity_bytes: 0, used_bytes: 0, free_bytes: 0, total_blocks: 0 })
    }
    async fn test_connection(&self) -> Result<()> { Ok(()) }
    fn name(&self) -> &str { "azure" }
    fn backend_type(&self) -> &'static str { "azure" }
}
