use axum::{
    extract::{Extension, Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;

use crate::auth::jwt::Claims;
use crate::auth::policy::{can_manage_dr, is_global_admin};
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

// --- rate limiting for /auth/sso/ldap/login (SEC-011) ---

const MAX_SSO_FAILED_ATTEMPTS: usize = 10;
const SSO_FAILURE_WINDOW_SECS: i64 = 300;

fn sso_login_attempts() -> &'static std::sync::Mutex<HashMap<String, Vec<i64>>> {
    static MAP: OnceLock<std::sync::Mutex<HashMap<String, Vec<i64>>>> = OnceLock::new();
    MAP.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn sso_rate_limited(username: &str) -> bool {
    let now = chrono::Utc::now().timestamp();
    let mut map = sso_login_attempts().lock().unwrap();
    let entry = map.entry(username.to_lowercase()).or_default();
    entry.retain(|&t| now - t < SSO_FAILURE_WINDOW_SECS);
    entry.len() >= MAX_SSO_FAILED_ATTEMPTS
}

fn sso_record_failure(username: &str) {
    let now = chrono::Utc::now().timestamp();
    let mut map = sso_login_attempts().lock().unwrap();
    map.entry(username.to_lowercase()).or_default().push(now);
}

async fn authorize(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::extract::Query(q): axum::extract::Query<AuthorizeQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let url = sso(&state)
        .initiate_auth(&id, &q.redirect_uri)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(serde_json::json!({ "authorization_url": url })))
}

async fn callback(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::extract::Query(q): axum::extract::Query<HashMap<String, String>>,
) -> Result<Json<SsoUserResponse>, StatusCode> {
    let code = q.get("code").ok_or(StatusCode::BAD_REQUEST)?;
    let state_param = q.get("state").cloned().unwrap_or_default();
    let redirect_uri = q.get("redirect_uri").cloned().unwrap_or_default();

    let user = sso(&state)
        .handle_callback(&id, code, &state_param, &redirect_uri)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(user.into()))
}

/// SEC-011: rate-limited LDAP login. Without this guard, an attacker can
/// brute-force AD credentials and (because AD has its own lockout policy)
/// cause an AD-wide account lockout denial-of-service.
async fn ldap_login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LdapLoginRequest>,
) -> Result<Json<SsoUserResponse>, StatusCode> {
    if sso_rate_limited(&req.username) {
        tracing::warn!(
            "LDAP login rate limit hit for user {} (SEC-011)",
            req.username
        );
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let result = sso(&state).ldap_auth(&req.username, &req.password).await;
    if result.is_err() {
        sso_record_failure(&req.username);
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Json(result.unwrap().into()))
}

async fn register_provider(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(provider): Json<SsoProvider>,
) -> Result<Json<SsoProvider>, StatusCode> {
    // SSO provider management is a security-sensitive admin surface;
    // the middleware already enforces global_admin on the /auth/sso
    // mutation paths, so this is belt-and-suspenders.
    if !is_global_admin(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    let _ = can_manage_dr; // keep import used
    let provider = sso(&state)
        .register_provider(provider)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(redact_provider(&provider)))
}

async fn add_ldap(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(cfg): Json<LdapConfig>,
) -> StatusCode {
    if !is_global_admin(&claims) {
        return StatusCode::FORBIDDEN;
    }
    sso(&state).add_ldap_config(cfg).await;
    StatusCode::OK
}

async fn list_providers(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<SsoProvider>>, StatusCode> {
    if !is_global_admin(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Json(
        sso(&state)
            .list_providers()
            .await
            .iter()
            .map(redact_provider)
            .collect(),
    ))
}

/// Never expose the IdP client secret through the API.
fn redact_provider(p: &SsoProvider) -> SsoProvider {
    let mut c = p.clone();
    c.encrypted_client_secret.clear();
    c
}
