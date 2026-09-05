use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// === Core Data Types ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockId {
    pub sha256: String,
    pub size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBlock {
    pub relative_path: String,
    pub offset: u64,
    pub size: u32,
    pub block_id: BlockId,
    pub metadata: FileMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub path: String,
    pub size: u64,
    pub modified_time: i64,
    pub mode: u32,
    pub owner: String,
    pub group: String,
    pub extended_attributes: HashMap<String, String>,
    pub acl: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: String,
    pub job_id: String,
    pub repository_id: String,
    pub snapshot_type: SnapshotType,
    pub parent_id: Option<String>,
    pub size_bytes: u64,
    pub unique_bytes: u64,
    pub compressed_bytes: u64,
    pub checksum: String,
    pub consistency: ConsistencyLevel,
    pub app_consistent: bool,
    pub created_at: i64,
    pub manifest_path: String,
    /// NULL = global/system snapshot.
    #[serde(default)]
    pub tenant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SnapshotType {
    Full,
    Incremental,
    Differential,
    SyntheticFull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConsistencyLevel {
    Consistent,
    CrashConsistent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub snapshot_id: String,
    pub parent_id: Option<String>,
    pub blocks: Vec<FileBlock>,
    pub total_size: u64,
    pub unique_size: u64,
    pub compressed_size: u64,
    pub file_count: u64,
    pub checksum: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CompressionAlgorithm {
    None,
    Zstd { level: i32 },
    Lz4,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EncryptionAlgorithm {
    None,
    Aes256Gcm,
    ChaCha20Poly1305,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineConfig {
    pub compression: CompressionAlgorithm,
    pub encryption: EncryptionAlgorithm,
    pub encryption_key: Option<Vec<u8>>,
    pub chunk_size: ChunkSizeConfig,
    pub throttle: Option<ThrottleConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkSizeConfig {
    pub min: u32,
    pub avg: u32,
    pub max: u32,
}

impl Default for ChunkSizeConfig {
    fn default() -> Self {
        Self { min: 4096, avg: 8192, max: 65536 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThrottleConfig {
    pub bandwidth_bps: u64,
    pub iops: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupStats {
    pub total_bytes: u64,
    pub unique_bytes: u64,
    pub compressed_bytes: u64,
    pub transferred_bytes: u64,
    pub files_processed: u64,
    pub blocks_deduped: u64,
    pub blocks_unique: u64,
    pub speed_bps: u64,
    pub dedup_ratio: f64,
    pub compression_ratio: f64,
    pub elapsed_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobInfo {
    pub id: Uuid,
    pub name: String,
    pub status: JobStatus,
    pub progress: f64,
    pub stats: Option<BackupStats>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed(String),
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct EventModel {
    pub id: i64,
    pub event_type: String,
    pub source: String,
    pub message: String,
    pub job_id: Option<String>,
    pub session_id: Option<String>,
    pub acknowledged: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventInfo {
    pub id: i64,
    pub event_type: String,
    pub source: String,
    pub message: String,
    pub job_id: Option<String>,
    pub session_id: Option<String>,
    pub created_at: i64,
}

impl From<EventModel> for EventInfo {
    fn from(m: EventModel) -> Self {
        Self {
            id: m.id,
            event_type: m.event_type,
            source: m.source,
            message: m.message,
            job_id: m.job_id,
            session_id: m.session_id,
            created_at: m.created_at,
        }
    }
}

/// True for addresses a server-side outbound request should never be allowed to
/// reach (SSRF guard): loopback, private, link-local (incl. cloud metadata
/// 169.254.x.x), unspecified and multicast.
pub fn is_private_or_blocked_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
    }
}
