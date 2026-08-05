use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::info;

/// LTFS (Linear Tape File System) — a simple index-based filesystem stored on
/// tape-like media. BCK emulates tape media as files on disk (for testing on
/// hosts without physical tape drives) while keeping the LTFS layout: an index
/// partition + a data partition.
///
/// Layout on a "tape file":
///   - Header (magic + version + block size)
///   - Index partition (serialized index, one JSON block)
///   - Data partition (append-only file records)
pub const LTFS_MAGIC: &[u8] = b"BCKLTFS01";

/// Fixed reserved size for the index partition (bytes). Large enough to hold
/// many thousands of file entries without shifting the data partition.
pub const INDEX_PARTITION_RESERVED: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LtfsInfo {
    pub blocks_used: u64,
    pub blocks_total: u64,
    pub block_size: u64,
    pub creation_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LtfsIndex {
    pub files: Vec<LtfsEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LtfsEntry {
    pub name: String,
    pub size: u64,
    pub offset: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountedLtfs {
    pub device: String,
    pub mount_point: String,
    pub index: LtfsIndex,
}

/// LTFS operations over a virtual tape file.
pub struct LtfsManager;

impl LtfsManager {
    pub fn new() -> Self {
        Self
    }

    fn tape_path(device: &str) -> PathBuf {
        PathBuf::from(device)
    }

    /// Format a tape with LTFS: write header + empty index partition.
    /// The index partition has a fixed reserved size so appending data never
    /// shifts existing file offsets.
    pub async fn format(&self, device: &str, block_size: u64) -> Result<()> {
        let path = Self::tape_path(device);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.ok();
        }
        let block_size = block_size.max(4096);
        let index = LtfsIndex { files: vec![] };
        let index_json = serde_json::to_vec(&index)?;

        let mut data = Vec::new();
        data.extend_from_slice(LTFS_MAGIC);
        data.extend_from_slice(&block_size.to_be_bytes());
        data.extend_from_slice(&(index_json.len() as u32).to_be_bytes());
        data.extend_from_slice(&index_json);
        // Reserve a large fixed index partition.
        let reserved = INDEX_PARTITION_RESERVED as usize;
        data.resize(data.len().max(reserved), 0);

        fs::write(&path, &data).await?;
        info!("LTFS formatted: {} (block_size={})", device, block_size);
        Ok(())
    }

    /// Read the index partition from a tape file.
    pub async fn read_index(&self, device: &str) -> Result<LtfsIndex> {
        let path = Self::tape_path(device);
        let data = fs::read(&path).await?;
        Self::parse_index(&data)
    }

    fn parse_index(data: &[u8]) -> Result<LtfsIndex> {
        if data.len() < LTFS_MAGIC.len() + 8 + 4 {
            bail!("Not an LTFS tape (short header)");
        }
        if &data[..LTFS_MAGIC.len()] != LTFS_MAGIC {
            bail!("Not an LTFS tape (bad magic)");
        }
        let idx = LTFS_MAGIC.len();
        let idx_len = u32::from_be_bytes(data[idx + 8..idx + 12].try_into()?) as usize;
        if idx + 12 + idx_len > data.len() {
            bail!("LTFS index exceeds tape size");
        }
        let index = serde_json::from_slice(&data[idx + 12..idx + 12 + idx_len])?;
        Ok(index)
    }

    /// Mount: read the index and remember the mount point.
    pub async fn mount(&self, device: &str, mount_point: &str) -> Result<MountedLtfs> {
        let index = self.read_index(device).await?;
        fs::create_dir_all(mount_point).await.ok();
        info!("LTFS mounted: {} -> {}", device, mount_point);
        Ok(MountedLtfs {
            device: device.to_string(),
            mount_point: mount_point.to_string(),
            index,
        })
    }

    /// Unmount: flush index back to the tape.
    pub async fn unmount(&self, mounted: &MountedLtfs) -> Result<()> {
        self.write_index(&mounted.device, &mounted.index).await?;
        info!("LTFS unmounted: {}", mounted.device);
        Ok(())
    }

    async fn write_index(&self, device: &str, index: &LtfsIndex) -> Result<()> {
        let path = Self::tape_path(device);
        let data = fs::read(&path).await?;
        let index_json = serde_json::to_vec(index)?;
        let block_size = if data.len() >= LTFS_MAGIC.len() + 8 {
            u64::from_be_bytes(data[LTFS_MAGIC.len()..LTFS_MAGIC.len() + 8].try_into()?)
        } else {
            4096
        };

        let data_base = INDEX_PARTITION_RESERVED as usize;
        let mut out = Vec::new();
        out.extend_from_slice(LTFS_MAGIC);
        out.extend_from_slice(&block_size.to_be_bytes());
        out.extend_from_slice(&(index_json.len() as u32).to_be_bytes());
        out.extend_from_slice(&index_json);
        out.resize(data_base, 0);
        // Preserve the data partition after the fixed index region.
        if data.len() > data_base {
            out.extend_from_slice(&data[data_base..]);
        }
        fs::write(&path, out).await?;
        Ok(())
    }

    /// Append a file to the data partition and update the index.
    pub async fn append_file(&self, device: &str, name: &str, content: &[u8]) -> Result<LtfsEntry> {
        let mut index = self.read_index(device).await?;
        let path = Self::tape_path(device);
        let data = fs::read(&path).await?;

        // Data partition always starts at the fixed reserved boundary.
        let data_base = INDEX_PARTITION_RESERVED as usize;
        let mut data_end = data_base as u64;
        for f in &index.files {
            data_end = data_end.max(f.offset + f.size);
        }

        let entry = LtfsEntry {
            name: name.to_string(),
            size: content.len() as u64,
            offset: data_end,
            created_at: chrono::Utc::now().timestamp(),
        };
        index.files.push(entry.clone());

        // Rebuild: fixed header (with updated index) + data partition.
        let mut header = Vec::new();
        header.extend_from_slice(LTFS_MAGIC);
        let block_size = if data.len() >= LTFS_MAGIC.len() + 8 {
            u64::from_be_bytes(data[LTFS_MAGIC.len()..LTFS_MAGIC.len() + 8].try_into()?)
        } else {
            4096
        };
        header.extend_from_slice(&block_size.to_be_bytes());
        let index_json = serde_json::to_vec(&index)?;
        header.extend_from_slice(&(index_json.len() as u32).to_be_bytes());
        header.extend_from_slice(&index_json);
        header.resize(data_base, 0);

        let mut out = header;
        if data.len() > data_base {
            out.extend_from_slice(&data[data_base..]);
        }
        out.extend_from_slice(content);

        fs::write(&path, out).await?;
        info!("LTFS appended: {} ({} bytes)", name, content.len());
        Ok(entry)
    }

    /// Read a file back from the data partition.
    pub async fn read_file(&self, device: &str, name: &str) -> Result<Vec<u8>> {
        let index = self.read_index(device).await?;
        let entry = index.files.iter().find(|f| f.name == name)
            .ok_or_else(|| anyhow!("File not on tape: {}", name))?;
        let data = fs::read(Self::tape_path(device)).await?;
        let start = (entry.offset as usize)
            .min(data.len());
        let end = (entry.offset as usize + entry.size as usize).min(data.len());
        Ok(data[start..end].to_vec())
    }

    /// Get filesystem info.
    pub async fn get_info(&self, device: &str) -> Result<LtfsInfo> {
        let path = Self::tape_path(device);
        if !path.exists() {
            return Ok(LtfsInfo {
                blocks_used: 0,
                blocks_total: 0,
                block_size: 0,
                creation_time: String::new(),
            });
        }
        let data = fs::read(&path).await?;
        let data_base = INDEX_PARTITION_RESERVED as usize;
        let block_size = if data.len() >= LTFS_MAGIC.len() + 8 {
            u64::from_be_bytes(data[LTFS_MAGIC.len()..LTFS_MAGIC.len() + 8].try_into()?)
        } else {
            4096
        };
        let blocks_total = (data.len() as u64).div_ceil(block_size);
        let blocks_used = (data_base as u64).div_ceil(block_size);
        let meta = fs::metadata(&path).await?;
        let created = meta.created().ok();
        let creation_time = created
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
            .unwrap_or(0)
            .to_string();
        Ok(LtfsInfo {
            blocks_used,
            blocks_total,
            block_size,
            creation_time,
        })
    }

    fn header_len(&self, data: &[u8]) -> Result<usize> {
        if data.len() < LTFS_MAGIC.len() + 12 {
            bail!("Short tape file");
        }
        let idx = LTFS_MAGIC.len();
        let idx_len = u32::from_be_bytes(data[idx + 8..idx + 12].try_into()?) as usize;
        Ok(idx + 12 + idx_len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn format_append_read() {
        let dir = std::env::temp_dir().join(format!("bck_ltfs_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).await.unwrap();
        let tape = dir.join("tape0.ltfs");
        let tape_str = tape.to_str().unwrap().to_string();

        let mgr = LtfsManager::new();
        mgr.format(&tape_str, 4096).await.unwrap();

        mgr.append_file(&tape_str, "vm1.vmdk", b"disk-data-1").await.unwrap();
        mgr.append_file(&tape_str, "vm2.vmdk", b"disk-data-2-longer").await.unwrap();

        let data = mgr.read_file(&tape_str, "vm1.vmdk").await.unwrap();
        assert_eq!(data, b"disk-data-1");
        let data2 = mgr.read_file(&tape_str, "vm2.vmdk").await.unwrap();
        assert_eq!(data2, b"disk-data-2-longer");

        let info = mgr.get_info(&tape_str).await.unwrap();
        assert!(info.block_size >= 4096);

        let index = mgr.read_index(&tape_str).await.unwrap();
        assert_eq!(index.files.len(), 2);
    }

    #[tokio::test]
    async fn bad_magic_fails() {
        let dir = std::env::temp_dir().join(format!("bck_ltfs_bad_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).await.unwrap();
        let tape = dir.join("bad.ltfs");
        fs::write(&tape, b"not-a-tape").await.unwrap();
        let mgr = LtfsManager::new();
        assert!(mgr.read_index(tape.to_str().unwrap()).await.is_err());
    }
}
