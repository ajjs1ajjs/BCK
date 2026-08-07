use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use std::sync::Arc;

use crate::cloud::{CloudAccount, CloudBackupManager};
use crate::server::AppState;

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_accounts).post(register_account))
        .route("/:id", axum::routing::get(get_account).delete(remove_account))
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
