pub mod ltfs;
pub mod library;
pub mod media;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use self::ltfs::LtfsManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapeDrive {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub device_path: String,
    pub drive_type: String,
    pub loaded_media: Option<String>,
    pub status: DriveStatus,
    pub capacity_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DriveStatus {
    Online,
    Offline,
    Loading,
    Writing,
    Reading,
    Cleaning,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapeMedia {
    #[serde(default)]
    pub id: String,
    pub barcode: String,
    pub capacity_bytes: u64,
    pub used_bytes: u64,
    pub media_type: String,
    pub status: MediaStatus,
    pub last_written: Option<i64>,
    pub retention_until: Option<i64>,
    pub location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MediaStatus {
    Available,
    InUse,
    Full,
    Archived,
    Damaged,
    Exporting,
}

/// Tape backup manager: manages drives and the media pool, writes backup data
/// to tapes via the LTFS layout (virtual tape files on disk for development).
pub struct TapeManager {
    drives: Arc<RwLock<Vec<TapeDrive>>>,
    media_pool: Arc<RwLock<Vec<TapeMedia>>>,
    ltfs: LtfsManager,
}

impl TapeManager {
    pub fn new() -> Self {
        Self {
            drives: Arc::new(RwLock::new(Vec::new())),
            media_pool: Arc::new(RwLock::new(Vec::new())),
            ltfs: LtfsManager::new(),
        }
    }

    /// Register a tape drive
    pub async fn register_drive(&self, drive: TapeDrive) -> Result<TapeDrive> {
        let mut drives = self.drives.write().await;
        let drive = TapeDrive {
            id: uuid::Uuid::new_v4().to_string(),
            ..drive
        };
        info!("Tape drive registered: {} at {}", drive.name, drive.device_path);
        drives.push(drive.clone());
        Ok(drive)
    }

    /// Register media into the pool (e.g. after an inventory scan).
    pub async fn add_media(&self, media: TapeMedia) -> Result<TapeMedia> {
        let mut pool = self.media_pool.write().await;
        if pool.iter().any(|m| m.barcode == media.barcode) {
            return Err(anyhow!("Media already in pool: {}", media.barcode));
        }
        pool.push(media.clone());
        info!("Tape media registered: {}", media.barcode);
        Ok(media)
    }

    fn validate_barcode(barcode: &str) -> Result<()> {
        if barcode.is_empty() || barcode.len() > 32 {
            anyhow::bail!("invalid barcode length");
        }
        if !barcode.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            anyhow::bail!("barcode contains invalid characters: {}", barcode);
        }
        if barcode.contains("..") || barcode.contains('/') || barcode.contains('\\') {
            anyhow::bail!("barcode must not contain path separators");
        }
        Ok(())
    }

    /// Format a tape with LTFS and register it as media.
    pub async fn format_media(&self, device_path: &str, barcode: &str, capacity_bytes: u64) -> Result<TapeMedia> {
        Self::validate_barcode(barcode)?;
        self.ltfs.format(device_path, 4096).await?;
        let media = TapeMedia {
            id: uuid::Uuid::new_v4().to_string(),
            barcode: barcode.to_string(),
            capacity_bytes,
            used_bytes: 0,
            media_type: "LTO-9".into(),
            status: MediaStatus::Available,
            last_written: None,
            retention_until: None,
            location: device_path.to_string(),
        };
        self.add_media(media.clone()).await?;
        Ok(media)
    }

    /// Load media into a drive (sets loaded_media on the drive).
    pub async fn load_media(&self, drive_id: &str, media_id: &str) -> Result<()> {
        let mut drives = self.drives.write().await;
        let drive = drives.iter_mut().find(|d| d.id == drive_id)
            .ok_or_else(|| anyhow!("Drive not found: {}", drive_id))?;
        let media = { self.media_pool.read().await.iter().find(|m| m.id == media_id).cloned() }
            .ok_or_else(|| anyhow!("Media not found: {}", media_id))?;
        drive.loaded_media = Some(media.barcode.clone());
        drive.status = DriveStatus::Online;
        info!("Tape media {} loaded into {}", media.barcode, drive.name);
        Ok(())
    }

    /// Write backup data to the loaded tape via LTFS.
    pub async fn write_to_tape(&self, drive_id: &str, name: &str, data: &[u8]) -> Result<u64> {
        let drives = self.drives.read().await;
        let drive = drives.iter().find(|d| d.id == drive_id)
            .ok_or_else(|| anyhow!("Drive not found: {}", drive_id))?;
        let barcode = drive.loaded_media.as_deref()
            .ok_or_else(|| anyhow!("No media loaded in drive {}", drive.name))?;

        let media = {
            let mut pool = self.media_pool.write().await;
            let m = pool.iter_mut().find(|m| m.barcode == barcode)
                .ok_or_else(|| anyhow!("Media not in pool: {}", barcode))?;
            if m.status == MediaStatus::Full {
                return Err(anyhow!("Media {} is full", barcode));
            }
            m.status = MediaStatus::InUse;
            m.last_written = Some(chrono::Utc::now().timestamp());
            m.clone()
        };

        let device = &media.location;
        let result = self.ltfs.append_file(device, name, data).await;
        match result {
            Ok(entry) => {
                let mut pool = self.media_pool.write().await;
                if let Some(m) = pool.iter_mut().find(|m| m.barcode == barcode) {
                    m.used_bytes += entry.size;
                    if m.used_bytes >= m.capacity_bytes {
                        m.status = MediaStatus::Full;
                    } else {
                        m.status = MediaStatus::Available;
                    }
                }
                info!("Wrote {} bytes to tape {}", data.len(), barcode);
                Ok(entry.size)
            }
            Err(e) => {
                let mut pool = self.media_pool.write().await;
                if let Some(m) = pool.iter_mut().find(|m| m.barcode == barcode) {
                    m.status = MediaStatus::Available;
                }
                Err(e)
            }
        }
    }

    /// Read backup data from the loaded tape via LTFS.
    pub async fn read_from_tape(&self, drive_id: &str, name: &str) -> Result<Vec<u8>> {
        let drives = self.drives.read().await;
        let drive = drives.iter().find(|d| d.id == drive_id)
            .ok_or_else(|| anyhow!("Drive not found: {}", drive_id))?;
        let barcode = drive.loaded_media.as_deref()
            .ok_or_else(|| anyhow!("No media loaded in drive {}", drive.name))?;
        let media = { self.media_pool.read().await.iter().find(|m| m.barcode == barcode).cloned() }
            .ok_or_else(|| anyhow!("Media not in pool: {}", barcode))?;
        self.ltfs.read_file(&media.location, name).await
    }

    /// Eject media from drive.
    pub async fn eject_media(&self, drive_id: &str) -> Result<()> {
        let mut drives = self.drives.write().await;
        let drive = drives.iter_mut().find(|d| d.id == drive_id)
            .ok_or_else(|| anyhow!("Drive not found: {}", drive_id))?;
        if let Some(barcode) = drive.loaded_media.take() {
            info!("Ejected {} from {}", barcode, drive.name);
        }
        Ok(())
    }

    /// Retire media older than the retention window.
    pub async fn apply_retention(&self, now_ts: i64) -> usize {
        let mut pool = self.media_pool.write().await;
        let mut retired = 0;
        for m in pool.iter_mut() {
            if let Some(until) = m.retention_until {
                if until < now_ts && m.status == MediaStatus::Archived {
                    m.status = MediaStatus::Available;
                    m.retention_until = None;
                    retired += 1;
                }
            }
        }
        if retired > 0 {
            info!("Tape retention: {} media released", retired);
        }
        retired
    }

    /// List all tape drives
    pub async fn list_drives(&self) -> Vec<TapeDrive> {
        self.drives.read().await.clone()
    }

    /// List media pool
    pub async fn list_media(&self) -> Vec<TapeMedia> {
        self.media_pool.read().await.clone()
    }

    /// Convenience: derive the media path from a root dir + barcode.
    pub fn media_path(root: &str, barcode: &str) -> String {
        Self::validate_barcode(barcode).expect("invalid barcode for media_path");
        PathBuf::from(root).join(format!("{}.ltfs", barcode)).to_string_lossy().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn format_write_read_eject() {
        let dir = std::env::temp_dir().join(format!("bck_tape_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let tape = TapeManager::media_path(dir.to_str().unwrap(), "BK0001L9");

        let mgr = TapeManager::new();
        let drive = mgr.register_drive(TapeDrive {
            id: String::new(),
            name: "Drive0".into(),
            device_path: "/dev/sg1".into(),
            drive_type: "LTO-9".into(),
            loaded_media: None,
            status: DriveStatus::Online,
            capacity_bytes: 18_000_000_000_000,
            used_bytes: 0,
        }).await.unwrap();

        let media = mgr.format_media(&tape, "BK0001L9", 18_000_000_000_000).await.unwrap();
        mgr.load_media(&drive.id, &media.id).await.unwrap();

        let written = mgr.write_to_tape(&drive.id, "vm.vmdk", b"block-data").await.unwrap();
        assert_eq!(written, 10);

        let data = mgr.read_from_tape(&drive.id, "vm.vmdk").await.unwrap();
        assert_eq!(data, b"block-data");

        mgr.eject_media(&drive.id).await.unwrap();
        assert!(mgr.read_from_tape(&drive.id, "vm.vmdk").await.is_err());
    }

    #[tokio::test]
    async fn retention_releases_media() {
        let mgr = TapeManager::new();
        let media = TapeMedia {
            id: "m1".into(),
            barcode: "BK0002L9".into(),
            capacity_bytes: 100,
            used_bytes: 10,
            media_type: "LTO-9".into(),
            status: MediaStatus::Archived,
            last_written: None,
            retention_until: Some(1000),
            location: "/tmp/x.ltfs".into(),
        };
        mgr.add_media(media).await.unwrap();
        let retired = mgr.apply_retention(2000).await;
        assert_eq!(retired, 1);
        let pool = mgr.list_media().await;
        assert_eq!(pool[0].status, MediaStatus::Available);
    }
}
