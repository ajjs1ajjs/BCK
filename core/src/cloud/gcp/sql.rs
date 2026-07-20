use anyhow::Result;
use tracing::info;

/// Cloud SQL backup
pub struct CloudSqlBackup;

impl CloudSqlBackup {
    pub fn new() -> Self {
        Self
    }

    /// Export Cloud SQL database
    pub async fn export(&self, _instance: &str, _bucket: &str, _filename: &str) -> Result<()> {
        info!("Exporting Cloud SQL: {} -> {}/{}", _instance, _bucket, _filename);
        // sql.instances.export
        Ok(())
    }

    /// Import Cloud SQL database
    pub async fn import(&self, _instance: &str, _bucket: &str, _filename: &str) -> Result<()> {
        info!("Importing Cloud SQL: {}/{} -> {}", _bucket, _filename, _instance);
        // sql.instances.import
        Ok(())
    }

    /// List export files
    pub async fn list_exports(&self, _instance: &str) -> Result<Vec<String>> {
        Ok(Vec::new())
    }
}
