//! Self-service portal: users submit restore requests and track them;
//! admins / operators approve, reject or complete requests via /admin.

use axum::{
    extract::{Extension, Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::restore::requests::RestoreRequest;
use crate::server::AppState;

const APPROVER_ROLES: [&str; 3] = ["admin", "operator", "super_admin"];

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/me", axum::routing::get(me))
        .route("/restore-requests", axum::routing::get(list_own).post(submit_request))
        .route("/restore-requests/:id/cancel", axum::routing::post(cancel_request))
        .route("/admin/restore-requests", axum::routing::get(list_all))
        .route("/admin/restore-requests/:id/approve", axum::routing::post(approve_request))
        .route("/admin/restore-requests/:id/reject", axum::routing::post(reject_request))
        .route("/admin/restore-requests/:id/complete", axum::routing::post(complete_request))
}

#[derive(Deserialize)]
pub struct SubmitRequest {
    pub snapshot_id: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub target_path: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Deserialize)]
pub struct DecisionRequest {
    #[serde(default)]
    pub note: String,
}

#[derive(Serialize)]
struct MeResponse {
    user_id: String,
    username: String,
    role: String,
    can_approve: bool,
}

async fn me(
    Extension(claims): Extension<Claims>,
) -> Json<MeResponse> {
    Json(MeResponse {
        user_id: claims.sub.clone(),
        username: claims.username.clone(),
        role: claims.role.clone(),
        can_approve: APPROVER_ROLES.contains(&claims.role.as_str()),
    })
}

async fn submit_request(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<SubmitRequest>,
) -> Result<(StatusCode, Json<RestoreRequest>), StatusCode> {
    let request = state.restore_requests.submit(
        &claims.sub,
        &claims.username,
        &req.snapshot_id,
        req.files,
        &req.target_path,
        &req.reason,
    ).await.map_err(|e| {
        tracing::error!("submit restore request: {}", e);
        StatusCode::BAD_REQUEST
    })?;
    Ok((StatusCode::CREATED, Json(request)))
}

async fn list_own(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Json<Vec<RestoreRequest>> {
    Json(state.restore_requests.list_for_user(&claims.sub).await)
}

async fn cancel_request(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if state.restore_requests.cancel(&id).await.unwrap_or(false) {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

async fn list_all(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<RestoreRequest>>, StatusCode> {
    if !APPROVER_ROLES.contains(&claims.role.as_str()) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Json(state.restore_requests.list_all().await))
}

async fn approve_request(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<DecisionRequest>,
) -> Result<StatusCode, StatusCode> {
    if !APPROVER_ROLES.contains(&claims.role.as_str()) {
        return Err(StatusCode::FORBIDDEN);
    }
    if state.restore_requests.approve(&id, &claims.username, &req.note).await.unwrap_or(false) {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

async fn reject_request(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<DecisionRequest>,
) -> Result<StatusCode, StatusCode> {
    if !APPROVER_ROLES.contains(&claims.role.as_str()) {
        return Err(StatusCode::FORBIDDEN);
    }
    if state.restore_requests.reject(&id, &claims.username, &req.note).await.unwrap_or(false) {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

async fn complete_request(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !APPROVER_ROLES.contains(&claims.role.as_str()) {
        return Err(StatusCode::FORBIDDEN);
    }
    if state.restore_requests.complete(&id).await.unwrap_or(false) {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}
