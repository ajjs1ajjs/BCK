use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

use crate::types::{BlockId, Snapshot, BackupManifest};

pub struct BlockIndex {
    db: Mutex<Connection>,
}

impl BlockIndex {
    pub fn new(path: &str) -> Result<Self> {
        let db_path = Path::new(path).join("index.db");
        let conn = Connection::open(&db_path)?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS blocks (
                sha256 TEXT PRIMARY KEY,
                size INTEGER NOT NULL,
                refcount INTEGER NOT NULL DEFAULT 1,
                compressed_size INTEGER,
                storage_path TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                repository_id TEXT NOT NULL,
                snapshot_type TEXT NOT NULL,
                parent_id TEXT,
                size_bytes INTEGER NOT NULL,
                unique_bytes INTEGER NOT NULL,
                compressed_bytes INTEGER NOT NULL,
                checksum TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                manifest_path TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS manifests (
                snapshot_id TEXT PRIMARY KEY,
                manifest BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_blocks_sha256 ON blocks(sha256);
            CREATE INDEX IF NOT EXISTS idx_snapshots_job ON snapshots(job_id);
            CREATE INDEX IF NOT EXISTS idx_snapshots_repo ON snapshots(repository_id);",
        )?;

        Ok(Self { db: Mutex::new(conn) })
    }

    pub fn block_exists(&self, sha256: &str) -> Result<bool> {
        let conn = self.db.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM blocks WHERE sha256 = ?1",
            [sha256],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn add_block(&self, id: &BlockId, compressed_size: u64, storage_path: &str) -> Result<()> {
        let conn = self.db.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO blocks (sha256, size, refcount, compressed_size, storage_path, created_at)
             VALUES (?1, ?2, 1, ?3, ?4, ?5)
             ON CONFLICT(sha256) DO UPDATE SET refcount = refcount + 1",
            rusqlite::params![id.sha256, id.size, compressed_size, storage_path, now],
        )?;
        Ok(())
    }

    pub fn remove_block(&self, sha256: &str) -> Result<bool> {
        let conn = self.db.lock().unwrap();
        conn.execute(
            "UPDATE blocks SET refcount = refcount - 1 WHERE sha256 = ?1",
            [sha256],
        )?;

        let refcount: i64 = conn.query_row(
            "SELECT refcount FROM blocks WHERE sha256 = ?1",
            [sha256],
            |row| row.get(0),
        ).unwrap_or(0);

        if refcount <= 0 {
            conn.execute("DELETE FROM blocks WHERE sha256 = ?1", [sha256])?;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn get_block_path(&self, sha256: &str) -> Result<Option<String>> {
        let conn = self.db.lock().unwrap();
        let result = conn.query_row(
            "SELECT storage_path FROM blocks WHERE sha256 = ?1",
            [sha256],
            |row| row.get(0),
        );
        match result {
            Ok(path) => Ok(Some(path)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn add_snapshot(&self, snapshot: &Snapshot) -> Result<()> {
        let conn = self.db.lock().unwrap();
        conn.execute(
            "INSERT INTO snapshots (id, job_id, repository_id, snapshot_type, parent_id,
             size_bytes, unique_bytes, compressed_bytes, checksum, created_at, manifest_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                snapshot.id, snapshot.job_id, snapshot.repository_id,
                format!("{:?}", snapshot.snapshot_type).to_lowercase(),
                snapshot.parent_id, snapshot.size_bytes, snapshot.unique_bytes,
                snapshot.compressed_bytes, snapshot.checksum, snapshot.created_at,
                snapshot.manifest_path
            ],
        )?;
        Ok(())
    }

    pub fn list_snapshots(&self, job_id: &str, limit: i64, offset: i64) -> Result<Vec<Snapshot>> {
        let conn = self.db.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, job_id, repository_id, snapshot_type, parent_id, size_bytes,
             unique_bytes, compressed_bytes, checksum, created_at, manifest_path
             FROM snapshots WHERE job_id = ?1
             ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
        )?;

        let snapshots = stmt.query_map(rusqlite::params![job_id, limit, offset], |row| {
            Ok(Snapshot {
                id: row.get(0)?,
                job_id: row.get(1)?,
                repository_id: row.get(2)?,
                snapshot_type: crate::types::SnapshotType::Full, // simplified
                parent_id: row.get(4)?,
                size_bytes: row.get(5)?,
                unique_bytes: row.get(6)?,
                compressed_bytes: row.get(7)?,
                checksum: row.get(8)?,
                consistency: crate::types::ConsistencyLevel::Consistent,
                app_consistent: false,
                created_at: row.get(9)?,
                manifest_path: row.get(10)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

        Ok(snapshots)
    }

    pub fn save_manifest(&self, snapshot_id: &str, manifest: &BackupManifest) -> Result<()> {
        let conn = self.db.lock().unwrap();
        let data = bincode::serialize(manifest)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO manifests (snapshot_id, manifest, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(snapshot_id) DO UPDATE SET manifest = ?2",
            rusqlite::params![snapshot_id, data, now],
        )?;
        Ok(())
    }

    pub fn load_manifest(&self, snapshot_id: &str) -> Result<Option<BackupManifest>> {
        let conn = self.db.lock().unwrap();
        let result = conn.query_row(
            "SELECT manifest FROM manifests WHERE snapshot_id = ?1",
            [snapshot_id],
            |row| row.get::<_, Vec<u8>>(0),
        );

        match result {
            Ok(data) => Ok(Some(bincode::deserialize(data.as_slice())?)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn dedup_stats(&self) -> Result<(u64, u64, u64)> {
        let conn = self.db.lock().unwrap();
        let total_refs: i64 = conn.query_row(
            "SELECT COALESCE(SUM(refcount), 0) FROM blocks", [], |row| row.get(0),
        )?;
        let unique: i64 = conn.query_row(
            "SELECT COUNT(*) FROM blocks", [], |row| row.get(0),
        )?;
        let total_size: i64 = conn.query_row(
            "SELECT COALESCE(SUM(size * refcount), 0) FROM blocks", [], |row| row.get(0),
        )?;
        Ok((total_refs as u64, unique as u64, total_size as u64))
    }
}
