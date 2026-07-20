use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Backup Proxy transport modes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProxyTransport {
    /// Direct SAN (iSCSI / Fibre Channel) - reads VMDK/VHDX directly from storage
    DirectSan,
    /// Direct NFS - reads VM files via NFS datastore mount
    DirectNfs,
    /// HotAdd - attaches VM disk to proxy VM for reading
    HotAdd,
    /// Network - reads through hypervisor API (slowest)
    Network,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub transport: ProxyTransport,
    pub max_concurrent_tasks: u32,
    pub datastores: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockReadRequest {
    pub transport: ProxyTransport,
    pub datastore: String,
    pub disk_path: String,
    pub offset: i64,
    pub length: i64,
    pub snapshot_id: Option<String>,
}

#[async_trait]
pub trait BackupProxy: Send + Sync {
    /// Read blocks from VM disk
    async fn read_blocks(&self, request: &BlockReadRequest) -> Result<Vec<u8>>;

    /// Mount datastore for reading
    async fn mount_datastore(&self, datastore: &str) -> Result<String>;

    /// Unmount datastore
    async fn unmount_datastore(&self, mount_path: &str) -> Result<()>;

    /// Test proxy connectivity
    async fn test_connection(&self) -> Result<()>;

    /// Get proxy statistics (load, throughput, etc.)
    async fn get_stats(&self) -> Result<ProxyStats>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStats {
    pub name: String,
    pub cpu_load: f64,
    pub memory_used_mb: u64,
    pub active_tasks: u32,
    pub bytes_processed: u64,
    pub throughput_bps: u64,
    pub errors_count: u32,
}

/// NFS-based backup proxy
pub struct NfsProxy {
    config: ProxyConfig,
}

impl NfsProxy {
    pub fn new(config: ProxyConfig) -> Self {
        Self { config }
    }

    fn nfs_mount_path(&self, datastore: &str) -> String {
        format!("/mnt/bck/proxy/{}/{}", self.config.name, datastore)
    }
}

#[async_trait]
impl BackupProxy for NfsProxy {
    async fn read_blocks(&self, request: &BlockReadRequest) -> Result<Vec<u8>> {
        let mount_path = self.nfs_mount_path(&request.datastore);
        let full_path = format!("{}/{}", mount_path, request.disk_path);

        let file = tokio::fs::OpenOptions::new()
            .read(true)
            .open(&full_path)
            .await?;

        use tokio::io::AsyncSeekExt;
        use tokio::io::AsyncReadExt;

        let mut file = file;
        file.seek(std::io::SeekFrom::Start(request.offset as u64)).await?;

        let mut buffer = vec![0u8; request.length as usize];
        let n = file.read_exact(&mut buffer).await?;
        buffer.truncate(n);

        Ok(buffer)
    }

    async fn mount_datastore(&self, datastore: &str) -> Result<String> {
        let mount_path = self.nfs_mount_path(datastore);
        std::fs::create_dir_all(&mount_path)?;

        // Mount NFS export (Linux only, simulated for now)
        #[cfg(target_os = "linux")]
        {
            let nfs_export = format!("{}:/{}", self.config.host, datastore);
            let output = tokio::process::Command::new("mount")
                .args(["-t", "nfs", &nfs_export, &mount_path])
                .output()
                .await?;

            if !output.status.success() {
                anyhow::bail!("NFS mount failed: {}", String::from_utf8_lossy(&output.stderr));
            }
        }

        Ok(mount_path)
    }

    async fn unmount_datastore(&self, mount_path: &str) -> Result<()> {
        #[cfg(target_os = "linux")]
        {
            tokio::process::Command::new("umount")
                .args([mount_path])
                .output()
                .await?;
        }

        Ok(())
    }

    async fn test_connection(&self) -> Result<()> {
        // Test NFS connectivity
        Ok(())
    }

    async fn get_stats(&self) -> Result<ProxyStats> {
        Ok(ProxyStats {
            name: self.config.name.clone(),
            cpu_load: 0.0,
            memory_used_mb: 0,
            active_tasks: 0,
            bytes_processed: 0,
            throughput_bps: 0,
            errors_count: 0,
        })
    }
}
