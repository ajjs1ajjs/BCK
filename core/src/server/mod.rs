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
use crate::cloud::restore::CloudRestoreManager;
use crate::config::AppConfig;
use crate::db::DbPool;
use crate::dr::DrOrchestrator;
use crate::enterprise::multitenant::TenantManager;
use crate::enterprise::sso::SsoManager;
use crate::job::JobManager;
use crate::m365::M365BackupManager;
use crate::restore::surebackup::SureBackupEngine;
use crate::restore::requests::RestoreRequestManager;
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
    pub agent_token: Option<String>,
    pub restore_tracker: RestoreTracker,
    pub instant_recovery: crate::restore::instant::InstantRecoveryRegistry,
    pub surebackup: SureBackupEngine,
    pub sso: SsoManager,
    pub sobr: SobrManager,
    pub cloud: CloudBackupManager,
    pub cloud_restore: CloudRestoreManager,
    pub m365: M365BackupManager,
    pub tape: TapeManager,
    pub cdp: CdpEngine,
    pub dr: DrOrchestrator,
    pub tenants: TenantManager,
    pub restore_requests: RestoreRequestManager,
}

pub fn create_router(state: Arc<AppState>) -> Router {
    let api = routes::api_routes(state.clone());

    // Same-origin by default (the SPA is served by this daemon). Cross-origin
    // is only allowed for explicitly configured origins — never `permissive()`.
    let cors = cors_layer(&state.config.server.allowed_origins);

    // Serve the built web UI (SPA) if a directory is configured and exists.
    let mut router = Router::new()
        .nest("/api/v1", api)
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(cors);

    if let Some(web_dir) = &state.config.server.web_ui_dir {
        if Path::new(web_dir).is_dir() {
            let index = web_dir.clone() + "/index.html";
            let serve = ServeDir::new(web_dir).fallback(ServeFile::new(index));
            router = router.nest_service("/", serve);
        }
    }

    router
}

fn cors_layer(allowed: &[String]) -> CorsLayer {
    if allowed.is_empty() {
        return CorsLayer::new();
    }
    use tower_http::cors::AllowOrigin;
    let origins: Vec<axum::http::HeaderValue> = allowed
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    if origins.is_empty() {
        return CorsLayer::new();
    }
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
        ])
        .allow_headers([axum::http::header::AUTHORIZATION, axum::http::header::CONTENT_TYPE])
        .allow_credentials(true)
}
