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
        // WAL + busy timeout let parallel backup jobs share one index without
        // random "database is locked" failures.
        conn.busy_timeout(std::time::Duration::from_secs(30))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS blocks (
                sha256 TEXT PRIMARY KEY,
                size INTEGER NOT NULL,
                refcount INTEGER NOT NULL DEFAULT 1 CHECK(refcount >= 0),
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

    /// Decrement a block's refcount, deleting the row when it reaches zero.
    ///
    /// DB-001: the decrement-and-sweep runs inside a single `BEGIN IMMEDIATE`
    /// write transaction, so two concurrent snapshot deletions can never both
    /// read a stale refcount and delete a block that is still referenced
    /// (data loss). The `refcount > 0` guard also makes double-deletes
    /// idempotent instead of driving the counter negative.
    pub fn remove_block(&self, sha256: &str) -> Result<bool> {
        let conn = self.db.lock().unwrap();
        conn.execute("BEGIN IMMEDIATE", [])?;
        let outcome: Result<bool> = (|| {
            let decremented = conn.execute(
                "UPDATE blocks SET refcount = refcount - 1 WHERE sha256 = ?1 AND refcount > 0",
                [sha256],
            )?;
            if decremented == 0 {
                // Missing row or already at zero — another deleter owns it.
                return Ok(false);
            }
            let deleted = conn.execute(
                "DELETE FROM blocks WHERE sha256 = ?1 AND refcount <= 0",
                [sha256],
            )?;
            Ok(deleted > 0)
        })();
        match outcome {
            Ok(freed) => {
                conn.execute("COMMIT", [])?;
                Ok(freed)
            }
            Err(e) => {
                let _ = conn.execute("ROLLBACK", []);
                Err(e)
            }
        }
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

    pub fn list_all_snapshots(&self) -> Result<Vec<Snapshot>> {
        let conn = self.db.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, job_id, repository_id, snapshot_type, parent_id, size_bytes,
             unique_bytes, compressed_bytes, checksum, created_at, manifest_path
             FROM snapshots ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], row_to_snapshot)?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Fetch a single snapshot by id (never by an empty job filter).
    pub fn get_snapshot_by_id(&self, snapshot_id: &str) -> Result<Option<Snapshot>> {
        let conn = self.db.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, job_id, repository_id, snapshot_type, parent_id, size_bytes,
             unique_bytes, compressed_bytes, checksum, created_at, manifest_path
             FROM snapshots WHERE id = ?1",
            [snapshot_id],
            row_to_snapshot,
        );
        match result {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Backdate (or re-stamp) a snapshot's creation time, e.g. when importing
    /// historical metadata into the index.
    pub fn set_snapshot_created_at(&self, snapshot_id: &str, created_at: i64) -> Result<()> {
        let conn = self.db.lock().unwrap();
        conn.execute(
            "UPDATE snapshots SET created_at = ?1 WHERE id = ?2",
            rusqlite::params![created_at, snapshot_id],
        )?;
        Ok(())
    }

    /// Delete a snapshot and its manifest. Blocks themselves are NOT removed;
    /// callers must reconcile block refcounts (see `remove_block`).
    pub fn delete_snapshot(&self, snapshot_id: &str) -> Result<()> {
        let conn = self.db.lock().unwrap();
        conn.execute("DELETE FROM manifests WHERE snapshot_id = ?1", [snapshot_id])?;
        conn.execute("DELETE FROM snapshots WHERE id = ?1", [snapshot_id])?;
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

        let rows = stmt.query_map(rusqlite::params![job_id, limit, offset], row_to_snapshot)?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
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

/// Parse the persisted lowercase snapshot-type string back into the enum.
fn parse_snapshot_type(s: &str) -> crate::types::SnapshotType {
    match s {
        "incremental" => crate::types::SnapshotType::Incremental,
        "differential" => crate::types::SnapshotType::Differential,
        "syntheticfull" => crate::types::SnapshotType::SyntheticFull,
        _ => crate::types::SnapshotType::Full,
    }
}

fn row_to_snapshot(row: &rusqlite::Row<'_>) -> rusqlite::Result<Snapshot> {
    let snapshot_type: String = row.get(3)?;
    Ok(Snapshot {
        id: row.get(0)?,
        job_id: row.get(1)?,
        repository_id: row.get(2)?,
        snapshot_type: parse_snapshot_type(&snapshot_type),
        parent_id: row.get(4)?,
        size_bytes: row.get(5)?,
        unique_bytes: row.get(6)?,
        compressed_bytes: row.get(7)?,
        checksum: row.get(8)?,
        consistency: crate::types::ConsistencyLevel::Consistent,
        app_consistent: false,
        created_at: row.get(9)?,
        manifest_path: row.get(10)?,
        tenant_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn temp_index(tag: &str) -> BlockIndex {
        let dir = std::env::temp_dir().join(format!("bck-index-{}-{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        BlockIndex::new(&dir.to_string_lossy()).unwrap()
    }

    fn test_block(id: &str) -> BlockId {
        BlockId { sha256: id.to_string(), size: 8 }
    }

    #[test]
    fn remove_block_deletes_at_zero_and_is_idempotent() {
        let index = temp_index("single");
        index.add_block(&test_block("aaa"), 8, "/store/aaa").unwrap();
        assert!(!index.block_exists("missing").unwrap());
        // refcount 1 -> 0 deletes the row.
        assert!(index.remove_block("aaa").unwrap());
        assert!(!index.block_exists("aaa").unwrap());
        // Double delete must not go negative or error.
        assert!(!index.remove_block("aaa").unwrap());
    }

    /// DB-001 regression: N concurrent deleters of a block with refcount N
    /// must free it exactly once and never drive refcount negative.
    #[test]
    fn concurrent_remove_block_frees_exactly_once() {
        let index = Arc::new(temp_index("concurrent"));
        let sha = "shared-block";
        for _ in 0..8 {
            index.add_block(&test_block(sha), 8, "/store/shared").unwrap();
        }
        let mut handles = Vec::new();
        for _ in 0..8 {
            let idx = index.clone();
            handles.push(std::thread::spawn(move || idx.remove_block(sha).unwrap()));
        }
        let mut freed = 0;
        for h in handles {
            if h.join().unwrap() {
                freed += 1;
            }
        }
        assert_eq!(freed, 1, "exactly one deleter must free the block");
        assert!(!index.block_exists(sha).unwrap());
        // Extra delete after free stays a no-op.
        assert!(!index.remove_block(sha).unwrap());
    }
}
