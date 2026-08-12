use axum::{
    extract::{Extension, Path, Query, State},
    Json,
    http::StatusCode,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::enterprise::multitenant::{Quota, ResourceUsage, Tenant, TenantSettings, TenantStatus};
use crate::server::AppState;

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_tenants).post(create_tenant))
        .route("/:id", axum::routing::get(get_tenant).delete(delete_tenant))
        .route("/:id/suspend", axum::routing::post(suspend_tenant))
        .route("/:id/activate", axum::routing::post(activate_tenant))
        .route("/:id/disable", axum::routing::post(disable_tenant))
        .route("/:id/quota", axum::routing::put(update_quota))
        .route("/:id/settings", axum::routing::put(update_settings))
        .route("/:id/usage", axum::routing::get(get_usage).post(update_usage))
        .route("/:id/check-quota", axum::routing::get(check_quota))
}

/// A tenant-scoped admin may manage only its own tenant; global admins /
/// super-admins (no tenant) manage all tenants.
fn can_manage_tenant(claims: &Claims, tenant_id: &str) -> bool {
    match &claims.tenant_id {
        None => true,
        Some(mine) => mine == tenant_id,
    }
}

/// Super-admins (and global admins with no tenant) may create tenants.
fn can_create_tenants(claims: &Claims) -> bool {
    claims.tenant_id.is_none()
}

#[derive(Deserialize)]
pub struct CreateTenantRequest {
    pub name: String,
    pub slug: String,
}

#[derive(Deserialize)]
pub struct CheckQuotaQuery {
    pub resource: String,
}

async fn list_tenants(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Json<Vec<Tenant>> {
    let tenants = state.tenants.list_tenants().await;
    Json(match &claims.tenant_id {
        None => tenants,
        Some(mine) => tenants.into_iter().filter(|t| &t.id == mine).collect(),
    })
}

async fn create_tenant(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateTenantRequest>,
) -> Result<(StatusCode, Json<Tenant>), StatusCode> {
    if !can_create_tenants(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    let tenant = state.tenants.create_tenant(&req.name, &req.slug).await
        .map_err(|e| {
            tracing::error!("create tenant: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(tenant)))
}

async fn get_tenant(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<Tenant>, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    state.tenants.get_tenant(&id).await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn delete_tenant(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> StatusCode {
    if !can_manage_tenant(&claims, &id) {
        return StatusCode::FORBIDDEN;
    }
    let removed = state.tenants.delete_tenant(&id).await
        .unwrap_or(false);
    if removed {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn suspend_tenant(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    if state.tenants.set_status(&id, TenantStatus::Suspended).await.unwrap_or(false) {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn activate_tenant(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    if state.tenants.set_status(&id, TenantStatus::Active).await.unwrap_or(false) {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn disable_tenant(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    if state.tenants.set_status(&id, TenantStatus::Disabled).await.unwrap_or(false) {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn update_quota(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(quota): Json<Quota>,
) -> Result<Json<Tenant>, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !state.tenants.update_quota(&id, quota).await.unwrap_or(false) {
        return Err(StatusCode::NOT_FOUND);
    }
    state.tenants.get_tenant(&id).await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn update_settings(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(settings): Json<TenantSettings>,
) -> Result<Json<Tenant>, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !state.tenants.update_settings(&id, settings).await.unwrap_or(false) {
        return Err(StatusCode::NOT_FOUND);
    }
    state.tenants.get_tenant(&id).await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn get_usage(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<ResourceUsage>, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    state.tenants.get_usage(&id).await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn update_usage(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(delta): Json<ResourceUsage>,
) -> Result<Json<ResourceUsage>, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !state.tenants.update_usage(&id, delta).await.unwrap_or(false) {
        return Err(StatusCode::NOT_FOUND);
    }
    state.tenants.get_usage(&id).await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn check_quota(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Query(q): Query<CheckQuotaQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !can_manage_tenant(&claims, &id) {
        return Err(StatusCode::FORBIDDEN);
    }
    let within = state.tenants.check_quota(&id, &q.resource).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Json(serde_json::json!({
        "tenant_id": id,
        "resource": q.resource,
        "within_quota": within,
    })))
}
