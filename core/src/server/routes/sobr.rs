use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use std::sync::Arc;

use crate::server::AppState;
use crate::sobr::{SobrPolicy, StorageTier};

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(tier_stats))
        .route("/tiers", axum::routing::post(add_tier))
        .route("/policies", axum::routing::get(list_policies).post(create_policy))
        .route("/policies/:id/execute", axum::routing::post(execute_policy))
}

async fn tier_stats(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<StorageTier>> {
    Json(state.sobr.get_tier_stats().await)
}

async fn add_tier(
    State(state): State<Arc<AppState>>,
    Json(tier): Json<StorageTier>,
) -> Result<(StatusCode, Json<StorageTier>), StatusCode> {
    let tier = state.sobr.add_tier(tier).await
        .map_err(|e| {
            tracing::error!("add SOBR tier: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(tier)))
}

async fn list_policies(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<SobrPolicy>> {
    Json(state.sobr.list_policies().await)
}

async fn create_policy(
    State(state): State<Arc<AppState>>,
    Json(policy): Json<SobrPolicy>,
) -> Result<(StatusCode, Json<SobrPolicy>), StatusCode> {
    let policy = state.sobr.create_policy(policy).await
        .map_err(|e| {
            tracing::error!("create SOBR policy: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(policy)))
}

async fn execute_policy(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let index_path = state.config.storage.default_path.to_string_lossy().into_owned();
    if let Err(e) = std::fs::create_dir_all(&index_path) {
        tracing::error!("SOBR index dir: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let index = Arc::new(crate::index::BlockIndex::new(&index_path).map_err(|e| {
        tracing::error!("SOBR index init: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?);
    let engine = crate::sobr::policy::DataLifecycleEngine::new(index);
    let moved = state.sobr.execute_data_movement(&id, &engine).await
        .map_err(|e| {
            tracing::error!("SOBR execute policy {}: {}", id, e);
            StatusCode::BAD_REQUEST
        })?;
    Ok(Json(serde_json::json!({ "policy_id": id, "moved_bytes": moved })))
}
