use axum::{extract::State, Json};
use serde::Serialize;
use std::sync::Arc;

use crate::server::AppState;

#[derive(Serialize)]
pub struct DashboardStats {
    pub total_jobs: i64,
    pub active_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub total_repositories: i64,
    pub total_snapshots: i64,
    pub storage_used_bytes: i64,
    pub storage_free_bytes: i64,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/stats", axum::routing::get(get_stats))
}

async fn get_stats(
    State(_state): State<Arc<AppState>>,
) -> Json<DashboardStats> {
    // TODO: query actual stats from database
    Json(DashboardStats {
        total_jobs: 0,
        active_jobs: 0,
        completed_jobs: 0,
        failed_jobs: 0,
        total_repositories: 0,
        total_snapshots: 0,
        storage_used_bytes: 0,
        storage_free_bytes: 0,
    })
}
