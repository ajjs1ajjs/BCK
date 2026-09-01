use axum::{
    extract::{Extension, Path, State},
    Json,
    http::StatusCode,
};
use serde::Serialize;
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::cloud::restore::{CloudRestore, RestoreRequest};
use crate::cloud::CloudAccount;
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

/// Load a cloud account the caller is allowed to see, or 404 (never 403: a
/// cross-tenant id must not be distinguishable from a non-existent one).
async fn load_scoped_account(
    state: &AppState,
    claims: &Claims,
    id: &str,
) -> Option<CloudAccount> {
    state.cloud.get_account(id).await
        .filter(|a| tenant_allows(claims, a.tenant_id.as_deref()))
}

#[derive(Serialize)]
struct RestorableKindDto {
    resource_type: String,
    label: String,
}

async fn list_restorable(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<Vec<RestorableKindDto>>, StatusCode> {
    let account = load_scoped_account(&state, &claims, &id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    let kinds = crate::cloud::restore::restorable_kinds(&account.provider);
    Ok(Json(kinds
        .into_iter()
        .map(|k| RestorableKindDto { resource_type: k.resource_type, label: k.label })
        .collect()))
}

async fn submit_restore(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<RestoreRequest>,
) -> Result<(StatusCode, Json<CloudRestore>), StatusCode> {
    let account = load_scoped_account(&state, &claims, &id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    let restore = state.cloud_restore.submit(&account, req).await
        .map_err(|e| {
            tracing::error!("submit cloud restore: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::ACCEPTED, Json(restore)))
}

async fn list_account_restores(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<Vec<CloudRestore>>, StatusCode> {
    load_scoped_account(&state, &claims, &id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(state.cloud_restore.list_for_account(&id).await))
}

async fn list_all_restores(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Json<Vec<CloudRestore>> {
    let all = state.cloud_restore.list().await;
    // Filter restores by the account's tenant so a tenant can only see restores
    // for accounts they own.
    let mut scoped = Vec::new();
    for r in all {
        if account_owned(&state, &claims, &r.account_id).await {
            scoped.push(r);
        }
    }
    Json(scoped)
}

async fn account_owned(
    state: &AppState,
    claims: &Claims,
    account_id: &str,
) -> bool {
    state.cloud.get_account(account_id).await
        .is_some_and(|a| tenant_allows(claims, a.tenant_id.as_deref()))
}

async fn get_restore(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(rid): Path<String>,
) -> Result<Json<CloudRestore>, StatusCode> {
    let restore = state.cloud_restore.get(&rid).await
        .ok_or(StatusCode::NOT_FOUND)?;
    // Verify the caller can access the account this restore belongs to.
    let account = state.cloud.get_account(&restore.account_id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    if !tenant_allows(&claims, account.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(restore))
}

async fn list_accounts(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Json<Vec<CloudAccount>> {
    let accounts = state.cloud.list_accounts().await;
    eprintln!("list_accounts: found {} accounts", accounts.len());
    for a in &accounts {
        eprintln!("  account id={}, tenant_id={:?}", a.id, a.tenant_id);
    }
    Json(
        accounts
            .into_iter()
            .filter(|a| tenant_allows(&claims, a.tenant_id.as_deref()))
            .map(|a| redact_account(&a))
            .collect()
    )
}

async fn register_account(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(mut account): Json<CloudAccount>,
) -> Result<(StatusCode, Json<CloudAccount>), StatusCode> {
    tracing::debug!("register_account: claims.sub={}", claims.sub);
    // Stamp the caller's tenant; a client-supplied tenant_id is ignored.
    account.tenant_id = scoped_tenant(&claims);
    let account = state.cloud.register_account(account).await
        .map_err(|e| {
            tracing::error!("register cloud account: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    Ok((StatusCode::CREATED, Json(redact_account(&account))))
}

async fn get_account(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<CloudAccount>, StatusCode> {
    eprintln!("get_account: id={}, claims.role={}", id, claims.role);
    let all = state.cloud.list_accounts().await;
    eprintln!("get_account: found {} accounts", all.len());
    for a in &all {
        eprintln!("  account id={}, tenant_id={:?}", a.id, a.tenant_id);
    }
    load_scoped_account(&state, &claims, &id).await
        .map(|a| Json(redact_account(&a)))
        .ok_or(StatusCode::NOT_FOUND)
}

pub fn router() -> axum::Router<Arc<AppState>> {
    async fn debug_handler() -> &'static str {
        "debug-route-matched"
    }
    let accounts_routes = axum::Router::new()
        .route("/", axum::routing::get(list_accounts).post(register_account))
        .route("/:id", axum::routing::get(get_account).delete(remove_account))
        .route("/:id/restorable", axum::routing::get(list_restorable))
        .route("/:id/restore", axum::routing::post(submit_restore))
        .route("/:id/restores", axum::routing::get(list_account_restores));
    axum::Router::new()
        .route("/debug", axum::routing::get(debug_handler))
        .nest("/accounts", accounts_routes)
        .route("/restores", axum::routing::get(list_all_restores))
        .route("/restores/:rid", axum::routing::get(get_restore))
}

/// Never serialize cloud credentials to API responses. The struct is the
/// persistence entity, so secrets are stripped before it leaves the server.
fn redact_account(a: &CloudAccount) -> CloudAccount {
    let mut c = a.clone();
    c.secret_key = None;
    c.session_token = None;
    c.client_secret = None;
    c
}

async fn remove_account(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Verify the account exists and belongs to the caller's tenant first.
    load_scoped_account(&state, &claims, &id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    if state.cloud.remove_account(&id).await {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}
