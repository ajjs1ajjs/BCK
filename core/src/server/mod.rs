pub mod routes;
pub mod middleware;

use axum::Router;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tower_http::compression::CompressionLayer;

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
    Router::new()
        .nest("/api/v1", routes::api_routes(state))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
}
