use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::ChangeEvent;

/// CDP Change Journal — persistent SQLite log of all filesystem changes
/// BUG-002: blocking rusqlite I/O is offloaded via spawn_blocking; the journal
/// holds a path (not a live Connection) so async tasks never block the runtime.
pub struct ChangeJournal {
    db_path: String,
}

impl ChangeJournal {
    pub fn new(db_path: &str) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS cdp_journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                path TEXT NOT NULL,
                change_type TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                checksum TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_cdp_journal_session ON cdp_journal(session_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_cdp_journal_time ON cdp_journal(timestamp);
            PRAGMA journal_mode=WAL;"
        )?;

        Ok(Self { db_path: db_path.to_string() })
    }

    fn _open(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    /// Record a change event in the journal
    pub async fn record_change(&self, session_id: &str, event: &ChangeEvent) -> Result<()> {
        let change_type = match event.change_type {
            super::ChangeType::Created => "created",
            super::ChangeType::Modified => "modified",
            super::ChangeType::Deleted => "deleted",
            super::ChangeType::Renamed { .. } => "renamed",
        }
        .to_string();
        let (sid, path, ts, size, csum) = (
            session_id.to_string(),
            event.path.clone(),
            event.timestamp,
            event.size,
            event.checksum.clone(),
        );
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let db = Connection::open(&db_path)?;
            db.execute(
                "INSERT INTO cdp_journal (session_id, path, change_type, timestamp, size, checksum)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![sid, path, change_type, ts, size as i64, csum],
            )?;
            Ok(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("journal spawn_blocking: {e}"))??;
        Ok(())
    }

    /// Query changes within a time range for PIT recovery
    pub async fn query_changes(
        &self,
        session_id: &str,
        from: i64,
        to: i64,
    ) -> Result<Vec<JournalEntry>> {
        let (sid, db_path) = (session_id.to_string(), self.db_path.clone());
        tokio::task::spawn_blocking(move || -> Result<Vec<JournalEntry>> {
            let db = Connection::open(&db_path)?;
            let mut stmt = db.prepare(
                "SELECT id, session_id, path, change_type, timestamp, size, checksum
                 FROM cdp_journal
                 WHERE session_id = ?1 AND timestamp >= ?2 AND timestamp <= ?3
                 ORDER BY timestamp ASC"
            )?;
            let entries = stmt.query_map(
                rusqlite::params![sid, from, to],
                |row| {
                    Ok(JournalEntry {
                        id: row.get(0)?,
                        session_id: row.get(1)?,
                        path: row.get(2)?,
                        change_type: row.get(3)?,
                        timestamp: row.get(4)?,
                        size: row.get::<_, i64>(5)? as u64,
                        checksum: row.get(6)?,
                    })
                },
            )?.collect::<Result<Vec<_>, _>>()?;
            Ok(entries)
        })
        .await
        .map_err(|e| anyhow::anyhow!("journal spawn_blocking: {e}"))?
    }

    /// Prune journal entries older than retention period
    pub async fn prune(&self, retention_days: u32) -> Result<u64> {
        let cutoff = chrono::Utc::now().timestamp() - (retention_days as i64 * 86400);
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || -> Result<u64> {
            let db = Connection::open(&db_path)?;
            let deleted = db.execute(
                "DELETE FROM cdp_journal WHERE timestamp < ?1",
                rusqlite::params![cutoff],
            )? as u64;
            if deleted > 0 {
                let _ = db.execute("PRAGMA incremental_vacuum", []);
                info!("CDP journal pruned: {} entries older than {} days", deleted, retention_days);
            }
            Ok(deleted)
        })
        .await
        .map_err(|e| anyhow::anyhow!("journal spawn_blocking: {e}"))?
    }

    /// Get journal stats
    pub async fn get_stats(&self, session_id: &str) -> Result<JournalStats> {
        let (sid, db_path) = (session_id.to_string(), self.db_path.clone());
        tokio::task::spawn_blocking(move || -> Result<JournalStats> {
            let db = Connection::open(&db_path)?;
            let (count, min_ts, max_ts): (i64, Option<i64>, Option<i64>) = db.query_row(
                "SELECT COUNT(*), MIN(timestamp), MAX(timestamp)
                 FROM cdp_journal WHERE session_id = ?1",
                rusqlite::params![sid],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            Ok(JournalStats {
                total_entries: count as u64,
                oldest: min_ts,
                newest: max_ts,
            })
        })
        .await
        .map_err(|e| anyhow::anyhow!("journal spawn_blocking: {e}"))?
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub id: i64,
    pub session_id: String,
    pub path: String,
    pub change_type: String,
    pub timestamp: i64,
    pub size: u64,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalStats {
    pub total_entries: u64,
    pub oldest: Option<i64>,
    pub newest: Option<i64>,
}
