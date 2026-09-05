use axum::{
    extract::{Extension, State},
    Json,
    http::StatusCode,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::m365::{M365BackupJob, M365BackupType, M365Tenant};
use crate::server::AppState;

/// The tenant a caller may operate on: super-admins (and global users with no
/// tenant) see everything; everyone else is confined to their own tenant.
fn scoped_tenant(claims: &Claims) -> Option<String> {
    if claims.role == "super_admin" {
        None
    } else {
        claims.tenant_id.clone()
    }
}

fn tenant_allows(claims: &Claims, owner: Option<&str>) -> bool {
    match scoped_tenant(claims) {
        None => true,
        Some(mine) => owner == Some(mine.as_str()),
    }
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/tenants", axum::routing::get(list_tenants).post(register_tenant))
        .route("/jobs", axum::routing::get(list_jobs).post(start_backup))
}

async fn list_tenants(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Json<Vec<M365Tenant>> {
    Json(
        state.m365.list_tenants().await
            .into_iter()
            .filter(|t| tenant_allows(&claims, t.tenant_id.as_deref()))
            .map(|t| redact_tenant(&t))
            .collect()
    )
}

async fn register_tenant(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(mut tenant): Json<M365Tenant>,
) -> Result<(StatusCode, Json<M365Tenant>), StatusCode> {
    // Stamp the caller's BCK owning tenant; azure_tenant_id is preserved from the
    // client request (it identifies the Azure AD tenant, not the BCK tenant).
    tenant.tenant_id = scoped_tenant(&claims);
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
    Extension(claims): Extension<Claims>,
) -> Json<Vec<M365BackupJob>> {
    let all = state.m365.list_jobs().await;
    let scoped: Vec<M365BackupJob> = all.into_iter()
        .filter(|j| tenant_allows(&claims, j.tenant_id.as_deref()))
        .collect();
    Json(scoped)
}

#[derive(Deserialize)]
pub struct StartBackupRequest {
    /// Azure AD tenant id (for lookup).
    #[serde(alias = "azure_tenant_id")]
    pub tenant_id: String,
    pub backup_type: M365BackupType,
}

async fn start_backup(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<StartBackupRequest>,
) -> Result<(StatusCode, Json<M365BackupJob>), StatusCode> {
    // Verify the M365 tenant exists and belongs to the caller's tenant.
    let tenants = state.m365.list_tenants().await;
    let tenant = tenants.iter().find(|t| {
        t.azure_tenant_id == req.tenant_id
            && tenant_allows(&claims, t.tenant_id.as_deref())
    }).ok_or(StatusCode::BAD_REQUEST)?;

    let job = state.m365.start_backup(&tenant.azure_tenant_id, req.backup_type).await
        .map_err(|e| {
            tracing::error!("start M365 backup: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(job)))
}
