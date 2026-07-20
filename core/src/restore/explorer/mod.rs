use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::index::BlockIndex;

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

    /// Extract a single file from snapshot (for preview/download)
    pub async fn extract_file(
        &self,
        _snapshot_id: &str,
        file_path: &str,
    ) -> Result<Vec<u8>> {
        info!("Extracting file: {}", file_path);
        // TODO: read blocks, reassemble file
        Err(anyhow::anyhow!("File extraction not implemented"))
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
