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
use crate::config::AppConfig;
use crate::db::DbPool;
use crate::job::JobManager;
use crate::restore::tracker::RestoreTracker;
use crate::scheduler::Scheduler;

pub struct AppState {
    pub config: AppConfig,
    pub db: DbPool,
    pub job_manager: Arc<Mutex<JobManager>>,
    pub scheduler: Arc<Mutex<Scheduler>>,
    pub jwt: JwtManager,
    pub restore_tracker: RestoreTracker,
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
