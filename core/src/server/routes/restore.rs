use axum::{
    extract::{Path, State, Query},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::server::AppState;

#[derive(Deserialize)]
pub struct VmRestoreRequest {
    pub snapshot_id: String,
    pub target_datastore: String,
    pub target_host: Option<String>,
    pub vm_name: Option<String>,
    pub power_on: bool,
}

#[derive(Deserialize)]
pub struct FileRestoreRequest {
    pub snapshot_id: String,
    pub files: Vec<String>,
    pub target_path: String,
    pub overwrite: Option<bool>,
}

#[derive(Deserialize)]
pub struct InstantRecoveryRequest {
    pub snapshot_id: String,
    pub vm_name: String,
    pub protocol: String,
    pub target_host: String,
    pub datastore: Option<String>,
}

#[derive(Serialize)]
pub struct RestoreSessionResponse {
    pub session_id: String,
    pub snapshot_id: String,
    pub restore_type: String,
    pub status: String,
    pub progress_pct: f64,
    pub target: String,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/vm", axum::routing::post(restore_vm))
        .route("/file", axum::routing::post(restore_file))
        .route("/instant", axum::routing::post(instant_recovery))
        .route("/instant/{id}/stop", axum::routing::post(stop_instant_recovery))
        .route("/explore/{snapshot_id}", axum::routing::get(browse_snapshot))
        .route("/surebackup", axum::routing::post(start_surebackup))
        .route("/session/{id}", axum::routing::get(get_session))
}

async fn restore_vm(
    State(_state): State<Arc<AppState>>,
    Json(_req): Json<VmRestoreRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    Err(StatusCode::NOT_IMPLEMENTED)
}

async fn restore_file(
    State(_state): State<Arc<AppState>>,
    Json(_req): Json<FileRestoreRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    Err(StatusCode::NOT_IMPLEMENTED)
}

async fn instant_recovery(
    State(_state): State<Arc<AppState>>,
    Json(_req): Json<InstantRecoveryRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    Err(StatusCode::NOT_IMPLEMENTED)
}

async fn stop_instant_recovery(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn browse_snapshot(
    State(_state): State<Arc<AppState>>,
    Path(_snapshot_id): Path<String>,
    Query(_params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    Err(StatusCode::NOT_IMPLEMENTED)
}

async fn start_surebackup(
    State(_state): State<Arc<AppState>>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn get_session(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    Err(StatusCode::NOT_FOUND)
}
