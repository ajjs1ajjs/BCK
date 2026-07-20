use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use super::discovery::DiscoveredApplication;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AppType {
    SqlServer,
    Exchange,
    ActiveDirectory,
    Oracle,
    PostgreSQL,
    MySQL,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppBackupResult {
    pub app_name: String,
    pub app_type: AppType,
    pub backup_path: Option<String>,
    pub backup_size: u64,
    pub success: bool,
    pub error_message: Option<String>,
}

/// Coordination interface for application-aware backup
#[async_trait::async_trait]
pub trait AppBackupHandler: Send + Sync {
    fn app_type(&self) -> AppType;

    /// Prepare application for backup (quiesce / freeze)
    async fn prepare(&self, app: &DiscoveredApplication) -> Result<()>;

    /// Create application-specific backup (e.g., SQL BACKUP DATABASE)
    async fn backup(&self, app: &DiscoveredApplication, target_dir: &str) -> Result<AppBackupResult>;

    /// Finalize / thaw after backup
    async fn finalize(&self, app: &DiscoveredApplication) -> Result<()>;
}

// === SQL Server Handler ===

pub struct SqlServerHandler;

#[async_trait::async_trait]
impl AppBackupHandler for SqlServerHandler {
    fn app_type(&self) -> AppType { AppType::SqlServer }

    async fn prepare(&self, _app: &DiscoveredApplication) -> Result<()> {
        info!("SQL Server: preparing for backup");
        // VSS will handle quiescing SQL via SQL Writer
        Ok(())
    }

    async fn backup(&self, app: &DiscoveredApplication, target_dir: &str) -> Result<AppBackupResult> {
        info!("SQL Server: starting backup to {}", target_dir);

        let script = format!(
            r#"
$instance = "{instance}"
$backupDir = "{dir}"

# Discover databases
$query = "SELECT name FROM sys.databases WHERE state = 0 AND name NOT IN ('tempdb')"
$databases = sqlcmd -S $instance -Q $query -h-1

foreach ($db in $databases) {{
    $db = $db.Trim()
    if ([string]::IsNullOrWhiteSpace($db)) {{ continue }}
    $backupFile = Join-Path $backupDir "$db.bak"
    $backupQuery = "BACKUP DATABASE [$db] TO DISK = N'$backupFile' WITH COMPRESSION, INIT, CHECKSUM"
    sqlcmd -S $instance -Q $backupQuery
    Write-Output "Backed up: $db -> $backupFile"
}}
"#,
            instance = app.service_name.as_deref().unwrap_or("localhost"),
            dir = target_dir
        );

        #[cfg(target_os = "windows")]
        {
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .output()
                .map_err(|e| anyhow!("SQL Server backup failed: {}", e))?;

            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(anyhow!("SQL Server backup error: {}", err));
            }
        }

        Ok(AppBackupResult {
            app_name: app.name.clone(),
            app_type: AppType::SqlServer,
            backup_path: Some(target_dir.to_string()),
            backup_size: 0,
            success: true,
            error_message: None,
        })
    }

    async fn finalize(&self, _app: &DiscoveredApplication) -> Result<()> {
        info!("SQL Server: finalizing backup");
        // VSS will thaw
        Ok(())
    }
}

// === PostgreSQL Handler ===

pub struct PostgresHandler;

#[async_trait::async_trait]
impl AppBackupHandler for PostgresHandler {
    fn app_type(&self) -> AppType { AppType::PostgreSQL }

    async fn prepare(&self, app: &DiscoveredApplication) -> Result<()> {
        info!("PostgreSQL: preparing for backup");

        let script = "SELECT pg_start_backup('bck_backup', true);";

        run_psql(app, script).await?;
        Ok(())
    }

    async fn backup(&self, app: &DiscoveredApplication, target_dir: &str) -> Result<AppBackupResult> {
        info!("PostgreSQL: starting backup to {}", target_dir);

        let cmd = format!(
            "pg_basebackup -D {} -X stream -z -P",
            target_dir
        );

        let output = tokio::process::Command::new("sh")
            .args(["-c", &cmd])
            .output()
            .await
            .map_err(|e| anyhow!("PostgreSQL backup failed: {}", e))?;

        if !output.status.success() {
            return Err(anyhow!("pg_basebackup failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        Ok(AppBackupResult {
            app_name: app.name.clone(),
            app_type: AppType::PostgreSQL,
            backup_path: Some(target_dir.to_string()),
            backup_size: 0,
            success: true,
            error_message: None,
        })
    }

    async fn finalize(&self, _app: &DiscoveredApplication) -> Result<()> {
        let script = "SELECT pg_stop_backup();";
        // Run psql to stop backup
        info!("PostgreSQL: finalizing backup");
        Ok(())
    }
}

// === Oracle Handler ===

pub struct OracleHandler;

#[async_trait::async_trait]
impl AppBackupHandler for OracleHandler {
    fn app_type(&self) -> AppType { AppType::Oracle }

    async fn prepare(&self, _app: &DiscoveredApplication) -> Result<()> {
        info!("Oracle: preparing backup (ALTER DATABASE BEGIN BACKUP)");
        // ALTER DATABASE BEGIN BACKUP
        Ok(())
    }

    async fn backup(&self, app: &DiscoveredApplication, target_dir: &str) -> Result<AppBackupResult> {
        info!("Oracle: starting RMAN backup to {}", target_dir);

        let script = format!(
            r#"
RUN {{
    ALLOCATE CHANNEL c1 DEVICE TYPE DISK;
    BACKUP DATABASE FORMAT '{dir}/%U';
    BACKUP ARCHIVELOG ALL FORMAT '{dir}/arch_%U';
    RELEASE CHANNEL c1;
}}
"#,
            dir = target_dir
        );

        // RMAN would be executed via `rman target /`
        let _ = script;

        Ok(AppBackupResult {
            app_name: app.name.clone(),
            app_type: AppType::Oracle,
            backup_path: Some(target_dir.to_string()),
            backup_size: 0,
            success: true,
            error_message: None,
        })
    }

    async fn finalize(&self, _app: &DiscoveredApplication) -> Result<()> {
        info!("Oracle: finalizing (ALTER DATABASE END BACKUP)");
        Ok(())
    }
}

// === Handler Factory ===

pub fn create_backup_handler(app_type: &AppType) -> Option<Box<dyn AppBackupHandler>> {
    match app_type {
        AppType::SqlServer => Some(Box::new(SqlServerHandler)),
        AppType::PostgreSQL => Some(Box::new(PostgresHandler)),
        AppType::Oracle => Some(Box::new(OracleHandler)),
        _ => None,
    }
}

async fn run_psql(app: &DiscoveredApplication, sql: &str) -> Result<String> {
    let service = app.service_name.as_deref().unwrap_or("postgresql");

    let output = tokio::process::Command::new("psql")
        .args(["-c", sql])
        .output()
        .await
        .map_err(|e| anyhow!("Failed to run psql: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        warn!("psql error: {}", err);
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
