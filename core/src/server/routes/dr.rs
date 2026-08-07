use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use std::sync::Arc;

use crate::dr::{DrPlan, DrSite, DrStatus};
use crate::server::AppState;

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/status", axum::routing::get(status))
        .route("/sites", axum::routing::get(list_sites).post(register_site))
        .route("/plans", axum::routing::get(list_plans).post(create_plan))
        .route("/plans/:id/failover", axum::routing::post(failover))
        .route("/plans/:id/failback", axum::routing::post(failback))
        .route("/plans/:id/test", axum::routing::post(test_failover))
}

async fn status(
    State(state): State<Arc<AppState>>,
) -> Json<DrStatus> {
    Json(state.dr.get_status().await)
}

async fn list_sites(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<DrSite>> {
    Json(state.dr.list_sites().await)
}

async fn register_site(
    State(state): State<Arc<AppState>>,
    Json(site): Json<DrSite>,
) -> Result<(StatusCode, Json<DrSite>), StatusCode> {
    let site = state.dr.register_site(site).await
        .map_err(|e| {
            tracing::error!("register DR site: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(site)))
}

async fn list_plans(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<DrPlan>> {
    Json(state.dr.list_plans().await)
}

async fn create_plan(
    State(state): State<Arc<AppState>>,
    Json(plan): Json<DrPlan>,
) -> Result<(StatusCode, Json<DrPlan>), StatusCode> {
    let plan = state.dr.create_plan(plan).await
        .map_err(|e| {
            tracing::error!("create DR plan: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(plan)))
}

async fn failover(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state.dr.execute_failover(&id).await
        .map_err(|e| {
            tracing::error!("DR failover {}: {}", id, e);
            StatusCode::BAD_REQUEST
        })?;
    Ok(Json(serde_json::json!({ "plan_id": id, "result": "failover_committed" })))
}

async fn failback(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state.dr.execute_failback(&id).await
        .map_err(|e| {
            tracing::error!("DR failback {}: {}", id, e);
            StatusCode::BAD_REQUEST
        })?;
    Ok(Json(serde_json::json!({ "plan_id": id, "result": "failback_committed" })))
}

async fn test_failover(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state.dr.test_failover(&id).await
        .map_err(|e| {
            tracing::error!("DR test failover {}: {}", id, e);
            StatusCode::BAD_REQUEST
        })?;
    Ok(Json(serde_json::json!({ "plan_id": id, "result": "test_failover_completed" })))
}
