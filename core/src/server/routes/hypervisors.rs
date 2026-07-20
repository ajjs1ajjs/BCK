use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::server::AppState;


#[derive(Serialize)]
pub struct HypervisorResponse {
    pub id: String,
    pub name: String,
    pub hv_type: String,
    pub host: String,
    pub status: String,
    pub version: Option<String>,
}

#[derive(Deserialize)]
pub struct AddHypervisorRequest {
    pub name: String,
    pub hv_type: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub ignore_ssl: Option<bool>,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_hypervisors).post(add_hypervisor))
        .route("/{id}", axum::routing::get(get_hypervisor).delete(delete_hypervisor))
        .route("/{id}/test", axum::routing::post(test_hypervisor))
        .route("/{id}/vms", axum::routing::get(list_vms))
}

async fn list_hypervisors(
    State(_state): State<Arc<AppState>>,
) -> Json<Vec<HypervisorResponse>> {
    // TODO: query from database
    Json(Vec::new())
}

async fn add_hypervisor(
    State(_state): State<Arc<AppState>>,
    Json(_req): Json<AddHypervisorRequest>,
) -> Result<Json<HypervisorResponse>, StatusCode> {
    // TODO: save to database
    Err(StatusCode::NOT_IMPLEMENTED)
}

async fn get_hypervisor(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> Result<Json<HypervisorResponse>, StatusCode> {
    Err(StatusCode::NOT_FOUND)
}

async fn delete_hypervisor(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn test_hypervisor(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Test connection to hypervisor
    Err(StatusCode::NOT_IMPLEMENTED)
}

async fn list_vms(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    Err(StatusCode::NOT_IMPLEMENTED)
}
