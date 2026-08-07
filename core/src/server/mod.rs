pub mod routes;
pub mod middleware;

use axum::Router;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::auth::jwt::JwtManager;
use crate::cdp::CdpEngine;
use crate::cloud::CloudBackupManager;
use crate::config::AppConfig;
use crate::db::DbPool;
use crate::dr::DrOrchestrator;
use crate::enterprise::multitenant::TenantManager;
use crate::enterprise::sso::SsoManager;
use crate::job::JobManager;
use crate::m365::M365BackupManager;
use crate::restore::surebackup::SureBackupEngine;
use crate::restore::tracker::RestoreTracker;
use crate::scheduler::Scheduler;
use crate::sobr::SobrManager;
use crate::tape::TapeManager;

pub struct AppState {
    pub config: AppConfig,
    pub db: DbPool,
    pub job_manager: Arc<Mutex<JobManager>>,
    pub scheduler: Arc<Mutex<Scheduler>>,
    pub jwt: JwtManager,
    pub restore_tracker: RestoreTracker,
    pub instant_recovery: crate::restore::instant::InstantRecoveryRegistry,
    pub surebackup: SureBackupEngine,
    pub sso: SsoManager,
    pub sobr: SobrManager,
    pub cloud: CloudBackupManager,
    pub m365: M365BackupManager,
    pub tape: TapeManager,
    pub cdp: CdpEngine,
    pub dr: DrOrchestrator,
    pub tenants: TenantManager,
}

pub fn create_router(state: Arc<AppState>) -> Router {
    let api = routes::api_routes(state.clone());

    // Serve the built web UI (SPA) if a directory is configured and exists.
    let mut router = Router::new()
        .nest("/api/v1", api)
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive());

    if let Some(web_dir) = &state.config.server.web_ui_dir {
        if Path::new(web_dir).is_dir() {
            let index = web_dir.clone() + "/index.html";
            let serve = ServeDir::new(web_dir).fallback(ServeFile::new(index));
            router = router.nest_service("/", serve);
        }
    }

    router
}
