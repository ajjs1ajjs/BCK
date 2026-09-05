use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use std::sync::Arc;

use crate::cdp::{CdpPolicy, CdpSession, CdpStats};
use crate::server::AppState;

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/policies", axum::routing::get(list_policies).post(create_policy))
        .route("/policies/:id/start", axum::routing::post(start_protection))
        .route("/sessions", axum::routing::get(list_sessions))
        .route("/sessions/:id/stop", axum::routing::post(stop_protection))
        .route("/stats", axum::routing::get(stats))
}

async fn list_policies(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<CdpPolicy>> {
    Json(state.cdp.list_policies().await)
}

async fn create_policy(
    State(state): State<Arc<AppState>>,
    Json(policy): Json<CdpPolicy>,
) -> Result<(StatusCode, Json<CdpPolicy>), StatusCode> {
    let policy = state.cdp.create_policy(policy).await
        .map_err(|e| {
            tracing::error!("create CDP policy: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(policy)))
}

async fn start_protection(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<CdpSession>), StatusCode> {
    let session = state.cdp.start_protection(&id).await
        .map_err(|e| {
            tracing::error!("start CDP protection: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(session)))
}

async fn list_sessions(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<CdpSession>> {
    Json(state.cdp.list_sessions().await)
}

async fn stop_protection(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    state.cdp.stop_protection(&id).await
        .map_err(|e| {
            tracing::error!("stop CDP protection: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok(StatusCode::OK)
}

async fn stats(
    State(state): State<Arc<AppState>>,
) -> Json<CdpStats> {
    Json(state.cdp.get_stats().await)
}
