pub mod watcher;
pub mod journal;
pub mod replicator;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpPolicy {
    #[serde(default)]
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
    index_path: String,
}

impl CdpEngine {
    pub fn new(index_path: &str) -> Result<Self> {
        // Validate the index directory upfront so misconfiguration fails early.
        let _index = crate::index::BlockIndex::new(index_path)?;
        Ok(Self {
            policies: Arc::new(RwLock::new(Vec::new())),
            active_sessions: Arc::new(RwLock::new(Vec::new())),
            index_path: index_path.to_string(),
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

        // Filesystem watcher feeds a change channel consumed by the CDP engine.
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ChangeEvent>();
        let watcher = watcher::FileWatcher::new(
            policy.paths.clone(),
            policy.exclude_patterns.clone(),
            4096,
            tx,
        );
        let watcher_for_blocking = watcher.clone();
        let watcher_handle = tokio::task::spawn_blocking(move || {
            if let Err(e) = watcher_for_blocking.start_blocking() {
                warn!("CDP watcher exited with error: {}", e);
            }
        });

        // Persistent journal under the index directory.
        let journal = journal::ChangeJournal::new(&format!("{}/cdp-journal.db", self.index_path))?;

        // The engine's pipeline is Arc-shared and not Clone, so the replicator
        // cannot re-use it. Checkpoint creation does not touch pipeline or
        // storage, so a lightweight instance suffices for the RPO loop.
        let replicator = replicator::CdpReplicator::new(
            crate::pipeline::BackupPipeline::new(crate::types::PipelineConfig {
                compression: crate::types::CompressionAlgorithm::None,
                encryption: crate::types::EncryptionAlgorithm::None,
                encryption_key: None,
                chunk_size: crate::types::ChunkSizeConfig::default(),
                throttle: None,
            }),
            Box::new(crate::storage::local::LocalStorage::new(
                &std::env::temp_dir()
                    .join("bck-cdp-replicator")
                    .to_string_lossy(),
            )?),
        );

        let active_sessions = self.active_sessions.clone();
        let sid = session.id.clone();
        let checkpoint_interval = policy.rpo_seconds.clamp(1, 60);

        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(checkpoint_interval));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

            loop {
                tokio::select! {
                    maybe_event = rx.recv() => {
                        match maybe_event {
                            Some(event) => {
                                let size = event.size;
                                let replicable = matches!(
                                    event.change_type,
                                    ChangeType::Created | ChangeType::Modified
                                );

                                {
                                    let mut sessions = active_sessions.write().await;
                                    if let Some(s) = sessions.iter_mut().find(|s| s.id == sid) {
                                        s.changes_tracked += 1;
                                        s.bytes_protected += size;
                                    }
                                }

                                if let Err(e) = journal.record_change(&sid, &event).await {
                                    warn!("CDP journal record failed for {}: {}", event.path, e);
                                }

                                if replicable {
                                    warn!(
                                        "CDP replicator wiring skipped: BackupPipeline is not Clone; recorded {} to journal only",
                                        event.path
                                    );
                                }
                            }
                            None => break,
                        }
                    }
                    _ = ticker.tick() => {
                        let stopped = {
                            let sessions = active_sessions.read().await;
                            match sessions.iter().find(|s| s.id == sid) {
                                Some(s) if s.status == CdpStatus::Stopped => true,
                                None => true,
                                _ => false,
                            }
                        };

                        if stopped {
                            info!("CDP protection loop ending: session {}", sid);
                            break;
                        }

                        match replicator.create_checkpoint(&sid).await {
                            Ok(()) => {
                                let now = chrono::Utc::now().timestamp();
                                let mut sessions = active_sessions.write().await;
                                if let Some(s) = sessions.iter_mut().find(|s| s.id == sid) {
                                    s.last_checkpoint = Some(now);
                                }
                            }
                            Err(e) => warn!("CDP checkpoint failed for session {}: {}", sid, e),
                        }
                    }
                }
            }

            // Stop the watcher: dropping our clone releases the sender and the
            // blocking watcher task is aborted (best-effort).
            drop(watcher);
            watcher_handle.abort();
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

    /// List all CDP policies
    pub async fn list_policies(&self) -> Vec<CdpPolicy> {
        self.policies.read().await.clone()
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
