use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::index::BlockIndex;
use crate::storage::StorageBackend;

/// Guest file explorer — browse files inside a VM snapshot
pub struct GuestFileExplorer {
    index: BlockIndex,
}

impl GuestFileExplorer {
    pub fn new(index_path: &str) -> Result<Self> {
        let index = BlockIndex::new(index_path)?;
        Ok(Self { index })
    }

    /// List files in a snapshot with optional path prefix filter
    pub async fn list_files(
        &self,
        snapshot_id: &str,
        prefix: &str,
    ) -> Result<Vec<FileEntry>> {
        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow::anyhow!("Snapshot not found: {}", snapshot_id))?;

        let mut entries: Vec<FileEntry> = manifest.blocks
            .iter()
            .filter(|b| b.relative_path.starts_with(prefix))
            .map(|b| FileEntry {
                path: b.relative_path.clone(),
                size: b.metadata.size,
                modified_at: b.metadata.modified_time,
                is_directory: false,
                owner: b.metadata.owner.clone(),
            })
            .collect();

        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    }

    /// List the immediate children of a directory inside a snapshot.
    ///
    /// Directory entries are derived from the path prefixes present in the
    /// manifest, so empty folders are not listed (the manifest only records
    /// files). The root directory is `/`.
    pub async fn list_directory(
        &self,
        snapshot_id: &str,
        dir: &str,
    ) -> Result<Vec<FileEntry>> {
        use std::collections::{HashMap, HashSet};

        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow::anyhow!("Snapshot not found: {}", snapshot_id))?;

        let dir = if dir.is_empty() {
            "/".to_string()
        } else if dir.starts_with('/') {
            dir.trim_end_matches('/').to_string()
        } else {
            format!("/{}", dir.trim_end_matches('/'))
        };
        let dir = if dir.is_empty() { "/".to_string() } else { dir };

        let mut sizes: HashMap<&str, u64> = HashMap::new();
        for b in &manifest.blocks {
            sizes
                .entry(b.relative_path.as_str())
                .or_insert(b.metadata.size);
        }

        let prefix = if dir == "/" {
            String::new()
        } else {
            format!("{}/", dir)
        };

        let mut entries: Vec<FileEntry> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        for path in sizes.keys() {
            let Some(rest) = path.strip_prefix(&prefix) else { continue };
            let rest = rest.trim_start_matches('/');
            let Some(first) = rest.split('/').next() else { continue };
            if first.is_empty() {
                continue;
            }
            let child = if prefix.is_empty() {
                format!("/{}", first)
            } else {
                format!("{}/{}", dir, first)
            };
            if !seen.insert(child.clone()) {
                continue;
            }
            let is_directory = rest.contains('/');
            entries.push(FileEntry {
                path: child,
                size: if is_directory { 0 } else { sizes[path] },
                modified_at: 0,
                is_directory,
                owner: String::new(),
            });
        }

        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    }

    /// Search files in snapshot by name pattern
    pub async fn search_files(
        &self,
        snapshot_id: &str,
        pattern: &str,
    ) -> Result<Vec<FileEntry>> {
        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow::anyhow!("Snapshot not found: {}", snapshot_id))?;

        let pattern_lower = pattern.to_lowercase();
        let entries: Vec<FileEntry> = manifest.blocks
            .iter()
            .filter(|b| b.relative_path.to_lowercase().contains(&pattern_lower))
            .map(|b| FileEntry {
                path: b.relative_path.clone(),
                size: b.metadata.size,
                modified_at: b.metadata.modified_time,
                is_directory: false,
                owner: b.metadata.owner.clone(),
            })
            .collect();

        Ok(entries)
    }

    /// Extract a single file from snapshot (for preview/download).
    ///
    /// Reassembles the file by reading the manifest blocks that belong to
    /// `file_path`, ordering them by offset and decoding each stored block
    /// (decompression / decryption) via [`crate::pipeline::decode_block`].
    pub async fn extract_file(
        &self,
        snapshot_id: &str,
        file_path: &str,
        storage: &dyn StorageBackend,
        key: Option<&[u8]>,
    ) -> Result<Vec<u8>> {
        info!("Extracting file: {} from snapshot {}", file_path, snapshot_id);
        let manifest = self.index.load_manifest(snapshot_id)?
            .ok_or_else(|| anyhow!("Snapshot not found: {}", snapshot_id))?;

        let mut blocks: Vec<&crate::types::FileBlock> = manifest.blocks
            .iter()
            .filter(|b| b.relative_path == file_path)
            .collect();
        if blocks.is_empty() {
            return Err(anyhow!("File not found in snapshot: {}", file_path));
        }
        blocks.sort_by_key(|b| b.offset);

        let mut out = Vec::with_capacity(blocks.first().map(|b| b.metadata.size as usize).unwrap_or(0));
        for block in blocks {
            let raw = storage.read_block(&block.block_id.sha256).await?;
            let data = crate::pipeline::decode_block(&raw, key)?;
            out.extend_from_slice(&data);
        }

        info!("Extracted {} ({} bytes)", file_path, out.len());
        Ok(out)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub modified_at: i64,
    pub is_directory: bool,
    pub owner: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::local::LocalStorage;
    use crate::types::{BackupManifest, BlockId, FileBlock, FileMetadata};
    use std::collections::HashMap;

    fn make_block(offset: u64, data: &[u8], id: &str) -> (FileBlock, Vec<u8>) {
        let block = FileBlock {
            relative_path: "/docs/file.txt".into(),
            offset,
            size: data.len() as u32,
            block_id: BlockId {
                sha256: id.into(),
                size: data.len() as u32,
            },
            metadata: FileMetadata {
                path: "/docs/file.txt".into(),
                size: 11,
                modified_time: 0,
                mode: 0o644,
                owner: "root".into(),
                group: "root".into(),
                extended_attributes: HashMap::new(),
                acl: vec![],
            },
        };
        let mut encoded = vec![crate::pipeline::MAGIC_RAW];
        encoded.extend_from_slice(data);
        (block, encoded)
    }

    #[tokio::test]
    async fn extract_file_reassembles_from_blocks() {
        let dir = std::env::temp_dir().join(format!("bck-explorer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let (b1, e1) = make_block(0, b"hello ", "block1");
        let (b2, e2) = make_block(6, b"world", "block2");
        let manifest = BackupManifest {
            snapshot_id: "snap1".into(),
            parent_id: None,
            blocks: vec![b1, b2],
            total_size: 11,
            unique_size: 11,
            compressed_size: 11,
            file_count: 1,
            checksum: "x".into(),
            created_at: 0,
        };

        let index = BlockIndex::new(dir.to_str().unwrap()).unwrap();
        index.save_manifest("snap1", &manifest).unwrap();

        let store_dir = dir.join("store");
        let store = LocalStorage::new(store_dir.to_str().unwrap()).unwrap();
        store.write_block("block1", &e1).await.unwrap();
        store.write_block("block2", &e2).await.unwrap();

        let explorer = GuestFileExplorer::new(dir.to_str().unwrap()).unwrap();
        let data = explorer.extract_file("snap1", "/docs/file.txt", &store, None).await.unwrap();
        assert_eq!(data, b"hello world");

        assert!(explorer.extract_file("snap1", "/nope.txt", &store, None).await.is_err());
        assert!(explorer.extract_file("snap-missing", "/docs/file.txt", &store, None).await.is_err());

        drop(explorer);
        drop(store);
        drop(index);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn list_directory_returns_immediate_children() {
        use std::collections::HashMap;

        let dir = std::env::temp_dir().join(format!("bck-explorer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        fn block_for(path: &str) -> FileBlock {
            FileBlock {
                relative_path: path.into(),
                offset: 0,
                size: 1,
                block_id: BlockId { sha256: path.into(), size: 1 },
                metadata: FileMetadata {
                    path: path.into(),
                    size: 1,
                    modified_time: 0,
                    mode: 0o644,
                    owner: "root".into(),
                    group: "root".into(),
                    extended_attributes: HashMap::new(),
                    acl: vec![],
                },
            }
        }

        let manifest = BackupManifest {
            snapshot_id: "snap1".into(),
            parent_id: None,
            blocks: vec![
                block_for("/etc/passwd"),
                block_for("/etc/ssh/sshd_config"),
                block_for("/home/user/file.txt"),
            ],
            total_size: 3,
            unique_size: 3,
            compressed_size: 3,
            file_count: 3,
            checksum: "x".into(),
            created_at: 0,
        };

        let index = BlockIndex::new(dir.to_str().unwrap()).unwrap();
        index.save_manifest("snap1", &manifest).unwrap();
        let explorer = GuestFileExplorer::new(dir.to_str().unwrap()).unwrap();

        let root = explorer.list_directory("snap1", "/").await.unwrap();
        assert_eq!(root.len(), 2);
        assert!(root.iter().any(|e| e.path == "/etc" && e.is_directory));
        assert!(root.iter().any(|e| e.path == "/home" && e.is_directory));

        let etc = explorer.list_directory("snap1", "/etc").await.unwrap();
        assert_eq!(etc.len(), 2);
        assert!(etc.iter().any(|e| e.path == "/etc/passwd" && !e.is_directory));
        assert!(etc.iter().any(|e| e.path == "/etc/ssh" && e.is_directory));

        let ssh = explorer.list_directory("snap1", "/etc/ssh/").await.unwrap();
        assert_eq!(ssh.len(), 1);
        assert_eq!(ssh[0].path, "/etc/ssh/sshd_config");

        drop(explorer);
        drop(index);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
