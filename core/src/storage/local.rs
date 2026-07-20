use anyhow::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::fs;
use sha2::{Digest, Sha256};

use super::{StorageBackend, StorageStats};

pub struct LocalStorage {
    root: PathBuf,
}

impl LocalStorage {
    pub fn new(path: &str) -> Result<Self> {
        let root = PathBuf::from(path);
        if !root.exists() {
            std::fs::create_dir_all(&root)?;
        }
        Ok(Self { root })
    }

    fn block_path(&self, id: &str) -> PathBuf {
        let hash = Sha256::digest(id.as_bytes());
        let hex = hex::encode(hash);
        self.root.join(&hex[..2]).join(&hex[2..4]).join(&hex)
    }
}

#[async_trait]
impl StorageBackend for LocalStorage {
    async fn write_block(&self, id: &str, data: &[u8]) -> Result<()> {
        let path = self.block_path(id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(&path, data).await?;
        Ok(())
    }

    async fn read_block(&self, id: &str) -> Result<Vec<u8>> {
        let path = self.block_path(id);
        Ok(fs::read(&path).await?)
    }

    async fn delete_block(&self, id: &str) -> Result<()> {
        let path = self.block_path(id);
        if path.exists() {
            fs::remove_file(&path).await?;
        }
        Ok(())
    }

    async fn exists(&self, id: &str) -> Result<bool> {
        Ok(self.block_path(id).exists())
    }

    async fn list_blocks(&self, prefix: &str) -> Result<Vec<String>> {
        let mut blocks = Vec::new();
        let prefix_path = if prefix.is_empty() {
            self.root.clone()
        } else {
            self.root.join(prefix)
        };

        if prefix_path.exists() {
            let mut dir = fs::read_dir(&prefix_path).await?;
            while let Some(entry) = dir.next_entry().await? {
                if entry.file_type().await?.is_file() {
                    if let Some(name) = entry.file_name().to_str() {
                        blocks.push(name.to_string());
                    }
                }
            }
        }
        Ok(blocks)
    }

    async fn stats(&self) -> Result<StorageStats> {
        let mut total_size = 0u64;
        let mut total_files = 0u64;
        collect_stats(&self.root, &mut total_size, &mut total_files)?;

        Ok(StorageStats {
            capacity_bytes: 0,
            used_bytes: total_size,
            free_bytes: 0,
            total_blocks: total_files,
        })
    }

    async fn test_connection(&self) -> Result<()> {
        if self.root.exists() {
            Ok(())
        } else {
            anyhow::bail!("Local storage path does not exist: {:?}", self.root)
        }
    }

    fn name(&self) -> &str {
        self.root.to_str().unwrap_or("local")
    }

    fn backend_type(&self) -> &'static str {
        "local"
    }
}

fn collect_stats(dir: &Path, total_size: &mut u64, total_files: &mut u64) -> Result<()> {
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                collect_stats(&path, total_size, total_files)?;
            } else if path.is_file() {
                *total_size += entry.metadata()?.len();
                *total_files += 1;
            }
        }
    }
    Ok(())
}
