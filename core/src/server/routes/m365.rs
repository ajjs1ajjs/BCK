use axum::{
    extract::State,
    Json,
    http::StatusCode,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::m365::{M365BackupJob, M365BackupType, M365Tenant};
use crate::server::AppState;

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/tenants", axum::routing::get(list_tenants).post(register_tenant))
        .route("/jobs", axum::routing::get(list_jobs).post(start_backup))
}

async fn list_tenants(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<M365Tenant>> {
    Json(state.m365.list_tenants().await.iter().map(redact_tenant).collect())
}

async fn register_tenant(
    State(state): State<Arc<AppState>>,
    Json(tenant): Json<M365Tenant>,
) -> Result<(StatusCode, Json<M365Tenant>), StatusCode> {
    let tenant = state.m365.register_tenant(tenant).await
        .map_err(|e| {
            tracing::error!("register M365 tenant: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(redact_tenant(&tenant))))
}

/// Strip the client secret from API responses — it is a credential and must
/// never be echoed back through the management API.
fn redact_tenant(t: &M365Tenant) -> M365Tenant {
    let mut c = t.clone();
    c.encrypted_secret.clear();
    c
}

async fn list_jobs(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<M365BackupJob>> {
    Json(state.m365.list_jobs().await)
}

#[derive(Deserialize)]
pub struct StartBackupRequest {
    pub tenant_id: String,
    pub backup_type: M365BackupType,
}

async fn start_backup(
    State(state): State<Arc<AppState>>,
    Json(req): Json<StartBackupRequest>,
) -> Result<(StatusCode, Json<M365BackupJob>), StatusCode> {
    let job = state.m365.start_backup(&req.tenant_id, req.backup_type).await
        .map_err(|e| {
            tracing::error!("start M365 backup: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(job)))
}
