use axum::{extract::State, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::server::AppState;

#[derive(Serialize)]
pub struct RepositoryResponse {
    pub id: String,
    pub name: String,
    pub repo_type: String,
    pub capacity_bytes: i64,
    pub used_bytes: i64,
    pub free_bytes: i64,
    pub status: String,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_repositories).post(create_repository))
        .route("/{id}", axum::routing::get(get_repository).delete(delete_repository))
}

async fn list_repositories(
    State(_state): State<Arc<AppState>>,
) -> Json<Vec<RepositoryResponse>> {
    Json(Vec::new())
}

#[derive(Deserialize)]
pub struct CreateRepoRequest {
    pub name: String,
    pub repo_type: String,
    pub path: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
}

async fn create_repository(
    State(_state): State<Arc<AppState>>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn get_repository(
    State(_state): State<Arc<AppState>>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn delete_repository(
    State(_state): State<Arc<AppState>>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}
