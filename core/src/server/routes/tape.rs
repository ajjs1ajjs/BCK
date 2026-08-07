use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::server::AppState;
use crate::tape::{TapeDrive, TapeMedia};

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/drives", axum::routing::get(list_drives).post(register_drive))
        .route("/drives/:id/load", axum::routing::post(load_media))
        .route("/drives/:id/eject", axum::routing::post(eject_media))
        .route("/drives/:id/write", axum::routing::post(write_tape))
        .route("/drives/:id/read", axum::routing::get(read_tape))
        .route("/media", axum::routing::get(list_media).post(add_media))
        .route("/media/format", axum::routing::post(format_media))
        .route("/retention", axum::routing::post(apply_retention))
}

async fn list_drives(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<TapeDrive>> {
    Json(state.tape.list_drives().await)
}

async fn register_drive(
    State(state): State<Arc<AppState>>,
    Json(drive): Json<TapeDrive>,
) -> Result<(StatusCode, Json<TapeDrive>), StatusCode> {
    let drive = state.tape.register_drive(drive).await
        .map_err(|e| {
            tracing::error!("register tape drive: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(drive)))
}

async fn list_media(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<TapeMedia>> {
    Json(state.tape.list_media().await)
}

async fn add_media(
    State(state): State<Arc<AppState>>,
    Json(media): Json<TapeMedia>,
) -> Result<(StatusCode, Json<TapeMedia>), StatusCode> {
    let media = state.tape.add_media(media).await
        .map_err(|e| {
            tracing::error!("add tape media: {}", e);
            StatusCode::CONFLICT
        })?;
    Ok((StatusCode::CREATED, Json(media)))
}

#[derive(Deserialize)]
pub struct FormatMediaRequest {
    pub device_path: String,
    pub barcode: String,
    pub capacity_bytes: u64,
}

async fn format_media(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FormatMediaRequest>,
) -> Result<(StatusCode, Json<TapeMedia>), StatusCode> {
    let media = state.tape.format_media(&req.device_path, &req.barcode, req.capacity_bytes).await
        .map_err(|e| {
            tracing::error!("format tape media: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(media)))
}

#[derive(Deserialize)]
pub struct LoadMediaRequest {
    pub media_id: String,
}

async fn load_media(
    State(state): State<Arc<AppState>>,
    Path(drive_id): Path<String>,
    Json(req): Json<LoadMediaRequest>,
) -> Result<StatusCode, StatusCode> {
    state.tape.load_media(&drive_id, &req.media_id).await
        .map_err(|e| {
            tracing::error!("load tape media: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok(StatusCode::OK)
}

async fn eject_media(
    State(state): State<Arc<AppState>>,
    Path(drive_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    state.tape.eject_media(&drive_id).await
        .map_err(|e| {
            tracing::error!("eject tape media: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
pub struct WriteTapeRequest {
    pub name: String,
    #[serde(default)]
    pub data_base64: String,
}

#[derive(Serialize)]
pub struct WriteTapeResponse {
    pub name: String,
    pub bytes_written: u64,
}

async fn write_tape(
    State(state): State<Arc<AppState>>,
    Path(drive_id): Path<String>,
    Json(req): Json<WriteTapeRequest>,
) -> Result<(StatusCode, Json<WriteTapeResponse>), StatusCode> {
    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.data_base64,
    )
    .map_err(|_| StatusCode::BAD_REQUEST)?;
    let written = state.tape.write_to_tape(&drive_id, &req.name, &data).await
        .map_err(|e| {
            tracing::error!("write tape: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::OK, Json(WriteTapeResponse { name: req.name, bytes_written: written })))
}

async fn read_tape(
    State(state): State<Arc<AppState>>,
    Path(drive_id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<ReadTapeQuery>,
) -> Result<Json<ReadTapeResponse>, StatusCode> {
    let data = state.tape.read_from_tape(&drive_id, &params.name).await
        .map_err(|e| {
            tracing::error!("read tape: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    let encoded = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &data,
    );
    Ok(Json(ReadTapeResponse { name: params.name, data_base64: encoded }))
}

#[derive(Deserialize)]
pub struct ReadTapeQuery {
    pub name: String,
}

#[derive(Serialize)]
pub struct ReadTapeResponse {
    pub name: String,
    pub data_base64: String,
}

#[derive(Serialize)]
pub struct RetentionResponse {
    pub media_released: usize,
}

async fn apply_retention(
    State(state): State<Arc<AppState>>,
) -> Json<RetentionResponse> {
    let released = state.tape.apply_retention(chrono::Utc::now().timestamp()).await;
    Json(RetentionResponse { media_released: released })
}
