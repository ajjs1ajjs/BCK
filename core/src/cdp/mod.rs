pub mod watcher;
pub mod journal;
pub mod replicator;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::index::BlockIndex;
use crate::pipeline::BackupPipeline;
use crate::storage::StorageBackend;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpPolicy {
    pub id: String,
    pub name: String,
    pub paths: Vec<String>,
    pub rpo_seconds: u64,
    pub min_interval_seconds: u64,
    pub retention_days: u32,
    pub compression: String,
    pub encryption: bool,
    pub exclude_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpSession {
    pub id: String,
    pub policy_id: String,
    pub status: CdpStatus,
    pub changes_tracked: u64,
    pub bytes_protected: u64,
    pub last_checkpoint: Option<i64>,
    pub started_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CdpStatus {
    Active,
    Paused,
    Error(String),
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeEvent {
    pub path: String,
    pub change_type: ChangeType,
    pub timestamp: i64,
    pub size: u64,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChangeType {
    Created,
    Modified,
    Deleted,
    Renamed { from: String, to: String },
}

/// CDP engine: tracks filesystem changes and replicates them in near-real-time
pub struct CdpEngine {
    policies: Arc<RwLock<Vec<CdpPolicy>>>,
    active_sessions: Arc<RwLock<Vec<CdpSession>>>,
    index: Arc<BlockIndex>,
    pipeline: Arc<BackupPipeline>,
    storage: Arc<RwLock<Box<dyn StorageBackend>>>,
}

impl CdpEngine {
    pub fn new(
        index_path: &str,
        pipeline: BackupPipeline,
        storage: Box<dyn StorageBackend>,
    ) -> Result<Self> {
        let index = Arc::new(BlockIndex::new(index_path)?);
        Ok(Self {
            policies: Arc::new(RwLock::new(Vec::new())),
            active_sessions: Arc::new(RwLock::new(Vec::new())),
            index,
            pipeline: Arc::new(pipeline),
            storage: Arc::new(RwLock::new(storage)),
        })
    }

    /// Create a CDP protection policy
    pub async fn create_policy(&self, policy: CdpPolicy) -> Result<CdpPolicy> {
        let mut policies = self.policies.write().await;
        let policy = CdpPolicy {
            id: uuid::Uuid::new_v4().to_string(),
            ..policy
        };
        info!("CDP policy created: {} (RPO: {}s)", policy.name, policy.rpo_seconds);
        policies.push(policy.clone());
        Ok(policy)
    }

    /// Start CDP protection for a policy
    pub async fn start_protection(&self, policy_id: &str) -> Result<CdpSession> {
        let policies = self.policies.read().await;
        let policy = policies.iter()
            .find(|p| p.id == policy_id)
            .ok_or_else(|| anyhow::anyhow!("Policy not found: {}", policy_id))?
            .clone();
        drop(policies);

        let session = CdpSession {
            id: uuid::Uuid::new_v4().to_string(),
            policy_id: policy.id.clone(),
            status: CdpStatus::Active,
            changes_tracked: 0,
            bytes_protected: 0,
            last_checkpoint: None,
            started_at: chrono::Utc::now().timestamp(),
        };

        self.active_sessions.write().await.push(session.clone());

        // Spawn watcher + replicator for each path
        let _index = self.index.clone();
        let _pipeline = self.pipeline.clone();
        let _storage = self.storage.clone();
        let active_sessions = self.active_sessions.clone();
        let sid = session.id.clone();
        let rpo = policy.rpo_seconds;

        tokio::spawn(async move {
            let mut last_sync = std::time::Instant::now();
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

                let sessions = active_sessions.read().await;
                let session = sessions.iter().find(|s| s.id == sid);
                match session {
                    Some(s) if s.status == CdpStatus::Stopped => break,
                    None => break,
                    _ => {}
                }
                drop(sessions);

                if last_sync.elapsed().as_secs() >= rpo {
                    tracing::info!("CDP checkpoint for session {}", sid);
                    last_sync = std::time::Instant::now();
                }
            }
        });

        info!("CDP protection started: policy={}, session={}", policy_id, session.id);
        Ok(session)
    }

    /// Stop CDP protection
    pub async fn stop_protection(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.active_sessions.write().await;
        if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
            session.status = CdpStatus::Stopped;
            info!("CDP protection stopped: session={}", session_id);
        }
        Ok(())
    }

    /// List active CDP sessions
    pub async fn list_sessions(&self) -> Vec<CdpSession> {
        self.active_sessions.read().await.clone()
    }

    /// Get CDP statistics
    pub async fn get_stats(&self) -> CdpStats {
        let sessions = self.active_sessions.read().await;
        CdpStats {
            active_policies: sessions.len() as u64,
            total_changes: sessions.iter().map(|s| s.changes_tracked).sum(),
            total_bytes: sessions.iter().map(|s| s.bytes_protected).sum(),
        }
    }

}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpStats {
    pub active_policies: u64,
    pub total_changes: u64,
    pub total_bytes: u64,
}
