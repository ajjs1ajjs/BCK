use anyhow::Result;
use uuid::Uuid;
use chrono::Utc;

use crate::index::BlockIndex;
use crate::types::{
    BackupManifest, ConsistencyLevel, FileBlock, Snapshot, SnapshotType,
};

pub struct SnapshotManager {
    index: BlockIndex,
}

impl SnapshotManager {
    pub fn new(index_path: &str) -> Result<Self> {
        let index = BlockIndex::new(index_path)?;
        Ok(Self { index })
    }

    pub fn create_snapshot(
        &self,
        job_id: &str,
        repository_id: &str,
        snapshot_type: &SnapshotType,
        parent_id: Option<&str>,
        blocks: Vec<FileBlock>,
    ) -> Result<Snapshot> {
        let now = Utc::now().timestamp();
        let id = Uuid::new_v4().to_string();

        let total_size: u64 = blocks.iter().map(|b| b.metadata.size).sum();

        let snapshot = Snapshot {
            id: id.clone(),
            job_id: job_id.to_string(),
            repository_id: repository_id.to_string(),
            snapshot_type: snapshot_type.clone(),
            parent_id: parent_id.map(|s| s.to_string()),
            size_bytes: total_size,
            unique_bytes: total_size,
            compressed_bytes: 0,
            checksum: String::new(),
            consistency: ConsistencyLevel::Consistent,
            app_consistent: false,
            created_at: now,
            manifest_path: format!("manifests/{}/{}.manifest", job_id, id),
        };

        let manifest = BackupManifest {
            snapshot_id: id.clone(),
            parent_id: parent_id.map(|s| s.to_string()),
            blocks,
            total_size: snapshot.size_bytes,
            unique_size: snapshot.unique_bytes,
            compressed_size: 0,
            file_count: 0,
            checksum: String::new(),
            created_at: now,
        };

        self.index.add_snapshot(&snapshot)?;
        self.index.save_manifest(&id, &manifest)?;

        Ok(snapshot)
    }

    pub fn get_snapshot(&self, snapshot_id: &str) -> Result<Option<Snapshot>> {
        let snapshots = self.index.list_snapshots("", 1, 0)?;
        Ok(snapshots.into_iter().find(|s| s.id == snapshot_id))
    }

    pub fn get_manifest(&self, snapshot_id: &str) -> Result<Option<BackupManifest>> {
        self.index.load_manifest(snapshot_id)
    }

    pub fn list_snapshots(&self, job_id: &str, limit: i64, offset: i64) -> Result<Vec<Snapshot>> {
        self.index.list_snapshots(job_id, limit, offset)
    }

    pub fn merge_snapshots(&self, _base: &str, _incremental: &str) -> Result<Snapshot> {
        anyhow::bail!("Snapshot merge not yet implemented")
    }
}
