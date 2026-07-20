use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::info;

/// CDP Change Journal — persistent log of all filesystem changes
/// Used to recover to any point in time within the retention window
pub struct ChangeJournal {
    db_path: String,
}

impl ChangeJournal {
    pub fn new(db_path: &str) -> Result<Self> {
        Ok(Self { db_path: db_path.to_string() })
    }

    /// Record a change event in the journal
    pub async fn record_change(&self, _event: &super::ChangeEvent) -> Result<()> {
        // TODO: insert into SQLite change journal table
        //   Columns: id, session_id, path, change_type, timestamp, size, checksum
        //   Indexed by (session_id, timestamp) for PIT recovery
        Ok(())
    }

    /// Query changes within a time range for PIT recovery
    pub async fn query_changes(
        &self,
        _session_id: &str,
        _from: i64,
        _to: i64,
    ) -> Result<Vec<super::ChangeEvent>> {
        Ok(Vec::new())
    }

    /// Prune journal entries older than retention period
    pub async fn prune(&self, _retention_days: u32) -> Result<u64> {
        info!("Pruning CDP journal older than {} days", _retention_days);
        Ok(0)
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
