use axum::{
    extract::{Path, State, Query},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use crate::enterprise::sso::{LdapConfig, SsoManager, SsoProvider, SsoUser};
use crate::server::AppState;

/// Public endpoints (authorize / callback / ldap login) — no JWT required.
pub fn public_router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/:id/authorize", axum::routing::get(authorize))
        .route("/:id/callback", axum::routing::get(callback))
        .route("/ldap/login", axum::routing::post(ldap_login))
}

/// Management endpoints (provider registration / listing) — JWT required.
pub fn protected_router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/providers", axum::routing::get(list_providers).post(register_provider))
        .route("/ldap", axum::routing::post(add_ldap))
}

#[derive(Deserialize)]
pub struct AuthorizeQuery {
    pub redirect_uri: String,
}

#[derive(Deserialize)]
pub struct LdapLoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct SsoUserResponse {
    pub external_id: String,
    pub email: String,
    pub display_name: String,
    pub provider_id: String,
    pub roles: Vec<String>,
    pub tenant_id: Option<String>,
}

impl From<SsoUser> for SsoUserResponse {
    fn from(u: SsoUser) -> Self {
        Self {
            external_id: u.external_id,
            email: u.email,
            display_name: u.display_name,
            provider_id: u.provider_id,
            roles: u.roles,
            tenant_id: u.tenant_id,
        }
    }
}

fn sso(state: &AppState) -> &SsoManager {
    &state.sso
}

async fn authorize(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<AuthorizeQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let url = sso(&state).initiate_auth(&id, &q.redirect_uri).await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(serde_json::json!({ "authorization_url": url })))
}

async fn callback(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<SsoUserResponse>, StatusCode> {
    let code = q.get("code").ok_or(StatusCode::BAD_REQUEST)?;
    let state_param = q.get("state").cloned().unwrap_or_default();
    let redirect_uri = q.get("redirect_uri").cloned().unwrap_or_default();

    let user = sso(&state).handle_callback(&id, code, &state_param, &redirect_uri).await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(user.into()))
}

async fn ldap_login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LdapLoginRequest>,
) -> Result<Json<SsoUserResponse>, StatusCode> {
    let user = sso(&state).ldap_auth(&req.username, &req.password).await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(user.into()))
}

async fn register_provider(
    State(state): State<Arc<AppState>>,
    Json(provider): Json<SsoProvider>,
) -> Result<Json<SsoProvider>, StatusCode> {
    let provider = sso(&state).register_provider(provider).await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(provider))
}

async fn add_ldap(
    State(state): State<Arc<AppState>>,
    Json(cfg): Json<LdapConfig>,
) -> StatusCode {
    sso(&state).add_ldap_config(cfg).await;
    StatusCode::OK
}

async fn list_providers(State(state): State<Arc<AppState>>) -> Json<Vec<SsoProvider>> {
    Json(sso(&state).list_providers().await)
}
