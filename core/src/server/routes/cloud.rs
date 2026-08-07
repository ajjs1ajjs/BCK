use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use serde::Serialize;
use std::sync::Arc;

use crate::cloud::restore::{CloudRestore, RestoreRequest};
use crate::cloud::{CloudAccount, CloudBackupManager};
use crate::server::AppState;

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_accounts).post(register_account))
        .route("/:id", axum::routing::get(get_account).delete(remove_account))
        .route("/:id/restorable", axum::routing::get(list_restorable))
        .route("/:id/restore", axum::routing::post(submit_restore))
        .route("/:id/restores", axum::routing::get(list_account_restores))
        .route("/restores", axum::routing::get(list_all_restores))
        .route("/restores/:rid", axum::routing::get(get_restore))
}

#[derive(Serialize)]
struct RestorableKindDto {
    resource_type: String,
    label: String,
}

async fn list_restorable(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<RestorableKindDto>>, StatusCode> {
    let account = state.cloud.get_account(&id).await.ok_or(StatusCode::NOT_FOUND)?;
    let kinds = crate::cloud::restore::restorable_kinds(&account.provider);
    Ok(Json(kinds
        .into_iter()
        .map(|k| RestorableKindDto { resource_type: k.resource_type, label: k.label })
        .collect()))
}

async fn submit_restore(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<RestoreRequest>,
) -> Result<(StatusCode, Json<CloudRestore>), StatusCode> {
    let account = state.cloud.get_account(&id).await.ok_or(StatusCode::NOT_FOUND)?;
    let restore = state.cloud_restore.submit(&account, req).await
        .map_err(|e| {
            tracing::error!("submit cloud restore: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::ACCEPTED, Json(restore)))
}

async fn list_account_restores(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<CloudRestore>>, StatusCode> {
    state.cloud.get_account(&id).await.ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(state.cloud_restore.list_for_account(&id).await))
}

async fn list_all_restores(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<CloudRestore>> {
    Json(state.cloud_restore.list().await)
}

async fn get_restore(
    State(state): State<Arc<AppState>>,
    Path(rid): Path<String>,
) -> Result<Json<CloudRestore>, StatusCode> {
    state.cloud_restore.get(&rid).await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn list_accounts(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<CloudAccount>> {
    Json(state.cloud.list_accounts().await)
}

async fn register_account(
    State(state): State<Arc<AppState>>,
    Json(account): Json<CloudAccount>,
) -> Result<(StatusCode, Json<CloudAccount>), StatusCode> {
    let account = state.cloud.register_account(account).await
        .map_err(|e| {
            tracing::error!("register cloud account: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(account)))
}

async fn get_account(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<CloudAccount>, StatusCode> {
    state.cloud.get_account(&id).await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn remove_account(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> StatusCode {
    let cloud: &CloudBackupManager = &state.cloud;
    if cloud.remove_account(&id).await {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}
