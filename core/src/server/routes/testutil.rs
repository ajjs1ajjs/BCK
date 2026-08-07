//! Shared test helpers for route modules (only compiled in test builds).

use crate::auth::jwt::JwtManager;
use crate::config::AppConfig;
use crate::job::JobManager;
use crate::scheduler::Scheduler;
use crate::server::AppState;
use std::sync::Arc;

/// Build an `AppState` backed by a fresh SQLite database in a temp dir.
pub async fn test_state(db_path: &str) -> Arc<AppState> {
    let url = format!("sqlite://{}?mode=rwc", db_path.replace('\\', "/"));
    let base = std::path::Path::new(db_path)
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let config = AppConfig {
        database: crate::config::DatabaseConfig {
            url: url.clone(),
            pool_size: 2,
            migrate: true,
        },
        storage: crate::config::StorageConfig {
            default_path: base.join("backups"),
            temp_path: base.join("tmp"),
        },
        ..AppConfig::default()
    };

    let db = crate::db::DbPool::connect(&url, config.database.pool_size)
        .await
        .unwrap();
    db.migrate().await.unwrap();
    let job_manager = Arc::new(tokio::sync::Mutex::new(JobManager::new(db.clone(), config.clone())));
    let scheduler = Arc::new(tokio::sync::Mutex::new(Scheduler::new(job_manager.clone())));
    let cdp_dir = db_path.replace(".db", "-cdp");
    std::fs::create_dir_all(&cdp_dir).unwrap();
    Arc::new(AppState {
        config,
        db,
        job_manager,
        scheduler,
        jwt: JwtManager::new(b"test-secret"),
        restore_tracker: crate::restore::tracker::RestoreTracker::new(),
        instant_recovery: crate::restore::instant::InstantRecoveryRegistry::new(),
        surebackup: crate::restore::surebackup::SureBackupEngine::new(),
        sso: crate::enterprise::sso::SsoManager::new(),
        sobr: crate::sobr::SobrManager::new(),
        cloud: crate::cloud::CloudBackupManager::new(),
        m365: crate::m365::M365BackupManager::new(),
        tape: crate::tape::TapeManager::new(),
        cdp: crate::cdp::CdpEngine::new(&cdp_dir).unwrap(),
        dr: crate::dr::DrOrchestrator::new(),
        tenants: crate::enterprise::multitenant::TenantManager::new(),
        restore_requests: crate::restore::requests::RestoreRequestManager::new(),
    })
}

/// Deserialize a JSON response body.
pub async fn read_json<T: serde::de::DeserializeOwned>(resp: axum::response::Response) -> T {
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
