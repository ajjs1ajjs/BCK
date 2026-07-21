use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tracing::info;

use super::ChangeEvent;

/// CDP Change Journal — persistent SQLite log of all filesystem changes
pub struct ChangeJournal {
    db: Mutex<Connection>,
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

        Ok(Self { db: Mutex::new(conn) })
    }

    /// Record a change event in the journal
    pub async fn record_change(&self, session_id: &str, event: &ChangeEvent) -> Result<()> {
        let change_type = match event.change_type {
            super::ChangeType::Created => "created",
            super::ChangeType::Modified => "modified",
            super::ChangeType::Deleted => "deleted",
            super::ChangeType::Renamed { .. } => "renamed",
        };

        let db = self.db.lock().unwrap();
        db.execute(
            "INSERT INTO cdp_journal (session_id, path, change_type, timestamp, size, checksum)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![session_id, event.path, change_type, event.timestamp, event.size, event.checksum],
        )?;

        Ok(())
    }

    /// Query changes within a time range for PIT recovery
    pub async fn query_changes(
        &self,
        session_id: &str,
        from: i64,
        to: i64,
    ) -> Result<Vec<JournalEntry>> {
        let db = self.db.lock().unwrap();
        let mut stmt = db.prepare(
            "SELECT id, session_id, path, change_type, timestamp, size, checksum
             FROM cdp_journal
             WHERE session_id = ?1 AND timestamp >= ?2 AND timestamp <= ?3
             ORDER BY timestamp ASC"
        )?;

        let entries = stmt.query_map(
            rusqlite::params![session_id, from, to],
            |row| {
                Ok(JournalEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    path: row.get(2)?,
                    change_type: row.get(3)?,
                    timestamp: row.get(4)?,
                    size: row.get(5)?,
                    checksum: row.get(6)?,
                })
            },
        )?.collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    /// Prune journal entries older than retention period
    pub async fn prune(&self, retention_days: u32) -> Result<u64> {
        let cutoff = chrono::Utc::now().timestamp() - (retention_days as i64 * 86400);
        let db = self.db.lock().unwrap();
        let deleted = db.execute(
            "DELETE FROM cdp_journal WHERE timestamp < ?1",
            rusqlite::params![cutoff],
        )? as u64;

        if deleted > 0 {
            db.execute("VACUUM", [])?;
            info!("CDP journal pruned: {} entries older than {} days", deleted, retention_days);
        }

        Ok(deleted)
    }

    /// Get journal stats
    pub async fn get_stats(&self, session_id: &str) -> Result<JournalStats> {
        let db = self.db.lock().unwrap();
        let (count, min_ts, max_ts): (i64, Option<i64>, Option<i64>) = db.query_row(
            "SELECT COUNT(*), MIN(timestamp), MAX(timestamp)
             FROM cdp_journal WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;

        Ok(JournalStats {
            total_entries: count as u64,
            oldest: min_ts,
            newest: max_ts,
        })
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
