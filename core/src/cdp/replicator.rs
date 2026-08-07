use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::info;

use crate::pipeline::BackupPipeline;
use crate::storage::StorageBackend;

/// Metadata persisted for each point-in-time checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CheckpointMarker {
    session_id: String,
    timestamp: i64,
    bytes: u64,
}

/// Near-sync replicator: sends changed blocks to backup storage
pub struct CdpReplicator {
    pipeline: BackupPipeline,
    storage: Box<dyn StorageBackend>,
}

impl CdpReplicator {
    pub fn new(pipeline: BackupPipeline, storage: Box<dyn StorageBackend>) -> Self {
        Self { pipeline, storage }
    }

    /// Replicate a changed file to backup storage
    pub async fn replicate_change(&mut self, path: &str, _change_id: &str) -> Result<()> {
        info!("CDP replicating: {}", path);
        let _result = self.pipeline.run(path, &*self.storage).await?;
        Ok(())
    }

    /// Create a point-in-time checkpoint
    ///
    /// Persists a JSON marker under the temp dir so `restore_to_time` can later
    /// select the latest checkpoint at or before a requested timestamp.
    pub async fn create_checkpoint(&self, session_id: &str) -> Result<()> {
        let marker = CheckpointMarker {
            session_id: session_id.to_string(),
            timestamp: chrono::Utc::now().timestamp(),
            bytes: 0,
        };

        let path = std::env::temp_dir().join(format!("bck-cdp-{}.checkpoint", session_id));
        let json = serde_json::to_string(&marker)?;
        std::fs::write(&path, json)?;

        info!(
            "CDP checkpoint created: {} (ts={})",
            path.display(),
            marker.timestamp
        );
        Ok(())
    }

    /// Restore files to a specific point in time
    ///
    /// Selects the latest checkpoint whose timestamp is at or before the
    /// requested time and reports it. Actual block materialization is left to
    /// the restore pipeline.
    pub async fn restore_to_time(&self, target_path: &str, timestamp: i64) -> Result<()> {
        let files = list_checkpoint_files()?;
        let selected = select_checkpoint(&files, timestamp)
            .ok_or_else(|| anyhow::anyhow!("no checkpoint before timestamp {}", timestamp))?;

        info!(
            "CDP restore to time {} selected checkpoint {} for target {}",
            timestamp,
            selected.display(),
            target_path
        );
        Ok(())
    }
}

/// List checkpoint marker files under the system temp directory.
fn list_checkpoint_files() -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(std::env::temp_dir())? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("bck-cdp-") && name.ends_with(".checkpoint") {
            files.push(entry.path());
        }
    }
    Ok(files)
}

/// Select the checkpoint file whose marker timestamp is the latest one that is
/// still at or before `timestamp`. Files that cannot be parsed are skipped.
pub fn select_checkpoint(files: &[PathBuf], timestamp: i64) -> Option<PathBuf> {
    let mut best: Option<(i64, PathBuf)> = None;
    for file in files {
        let Ok(data) = std::fs::read_to_string(file) else { continue };
        let Ok(marker) = serde_json::from_str::<CheckpointMarker>(&data) else { continue };
        if marker.timestamp <= timestamp {
            match &best {
                Some((best_ts, _)) if *best_ts >= marker.timestamp => {}
                _ => best = Some((marker.timestamp, file.clone())),
            }
        }
    }
    best.map(|(_, path)| path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marker_file(dir: &std::path::Path, ts: i64) -> PathBuf {
        let path = dir.join(format!("bck-cdp-s{}.checkpoint", ts));
        let marker = CheckpointMarker {
            session_id: "s1".into(),
            timestamp: ts,
            bytes: 0,
        };
        std::fs::write(&path, serde_json::to_string(&marker).unwrap()).unwrap();
        path
    }

    #[test]
    fn select_checkpoint_picks_latest_before_timestamp() {
        let dir = std::env::temp_dir().join(format!("bck_cdp_select_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let old = marker_file(&dir, 1000);
        let mid = marker_file(&dir, 2000);
        let _new = marker_file(&dir, 3000);

        let files = vec![old.clone(), mid.clone()];
        assert_eq!(select_checkpoint(&files, 2500), Some(mid.clone()));
        assert_eq!(select_checkpoint(&files, 1500), Some(old.clone()));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn select_checkpoint_returns_none_when_no_match() {
        let dir = std::env::temp_dir().join(format!("bck_cdp_none_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let file = marker_file(&dir, 5000);
        assert_eq!(select_checkpoint(&[file], 100), None);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn select_checkpoint_ignores_unparseable_files() {
        let dir = std::env::temp_dir().join(format!("bck_cdp_bad_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let good = marker_file(&dir, 42);
        let bad = dir.join("bck-cdp-sbroken.checkpoint");
        std::fs::write(&bad, "not-json").unwrap();

        assert_eq!(select_checkpoint(&[good.clone(), bad], 50), Some(good.clone()));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
