use axum::{extract::{Path, State}, Json, http::StatusCode};
use serde::Serialize;
use std::sync::Arc;

use crate::server::AppState;

#[derive(Serialize)]
pub struct SnapshotResponse {
    pub id: String,
    pub job_id: String,
    pub snapshot_type: String,
    pub size_bytes: i64,
    pub created_at: i64,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_snapshots))
        .route("/{id}", axum::routing::get(get_snapshot).delete(delete_snapshot))
}

async fn list_snapshots(
    State(_state): State<Arc<AppState>>,
) -> Json<Vec<SnapshotResponse>> {
    Json(Vec::new())
}

async fn get_snapshot(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn delete_snapshot(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}
