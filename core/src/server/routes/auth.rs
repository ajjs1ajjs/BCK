use axum::{
    extract::{Extension, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::auth::{User, UserRole, hash_password, verify_password};
use crate::db::models::user::UserModel;
use crate::db::DbPool;
use crate::server::AppState;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: User,
}

/// Public router (login only).
pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new().route("/login", axum::routing::post(login))
}

/// JWT-protected router (`/me` requires a validated token).
pub fn protected_router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/me", axum::routing::get(me))
        .route("/logout", axum::routing::post(logout))
}

// --- login rate limiting (in-memory, per-username+IP) ---

const MAX_FAILED_ATTEMPTS: usize = 10;
const FAILURE_WINDOW_SECS: i64 = 300;

/// Rolling window of failed-login timestamps per username+IP key.
/// SEC-011: key includes caller IP so rotating usernames does not bypass the
/// limit; per-username entry is kept for backward compat defense in depth.
fn login_attempts() -> &'static dashmap::DashMap<String, Vec<i64>> {
    static MAP: std::sync::OnceLock<dashmap::DashMap<String, Vec<i64>>> = std::sync::OnceLock::new();
    MAP.get_or_init(dashmap::DashMap::new)
}

fn throttle_key(username: &str, ip: Option<&str>) -> String {
    format!("{}|{}", username.to_lowercase(), ip.unwrap_or("unknown"))
}

#[allow(dead_code)]
fn rate_limited(username: &str) -> bool {
    rate_limited_for(&throttle_key(username, None)) || rate_limited_for(&username.to_lowercase())
}

fn rate_limited_for(key: &str) -> bool {
    let now = chrono::Utc::now().timestamp();
    let mut entry = login_attempts().entry(key.to_string()).or_default();
    entry.retain(|&t| now - t < FAILURE_WINDOW_SECS);
    entry.len() >= MAX_FAILED_ATTEMPTS
}

#[allow(dead_code)]
fn record_failure(username: &str) {
    record_failure_for(&throttle_key(username, None));
    record_failure_for(&username.to_lowercase());
}

fn record_failure_for(key: &str) {
    let now = chrono::Utc::now().timestamp();
    login_attempts().entry(key.to_string()).or_default().push(now);
    // Bound memory: drop oldest if a single key explodes.
    let mut e = login_attempts().entry(key.to_string()).or_default();
    if e.len() > 100 {
        let excess = e.len() - 100;
        e.drain(..excess);
    }
}

/// A valid Argon2 hash of a throwaway password, used to equalize the cost of a
/// login attempt against an unknown username (prevents timing-based username
/// enumeration).
fn dummy_hash() -> &'static str {
    static DUMMY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DUMMY.get_or_init(|| hash_password("bck-dummy-timing-equalizer"))
}

async fn login(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<axum::response::Response, StatusCode> {
    // SEC-011: per-username+IP key (X-Forwarded-For when behind proxy, else unknown).
    // Plaintext HTTP listener already provides ConnectInfo, but TLS custom serve
    // does not propagate it — headers keep both paths working.
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| headers.get("x-real-ip").and_then(|v| v.to_str().ok()).map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string());
    let key = throttle_key(&req.username, Some(&ip));
    if rate_limited_for(&key) || rate_limited_for(&req.username.to_lowercase()) {
        tracing::warn!("login rate limit hit for user {} ip {}", req.username, ip);
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    let user = find_user(&state.db, &req.username).await;

    // Unknown users still pay for a full Argon2 verification against a dummy
    // hash so response timing does not reveal whether a username exists.
    let (user_model, hash, enabled) = match user {
        Ok(Some(u)) => {
            let enabled = u.enabled;
            let hash = u.password_hash.clone();
            (Some(u), hash, enabled)
        }
        _ => (None, dummy_hash().to_string(), false),
    };

    if !verify_password(&req.password, &hash) {
        record_failure_for(&key);
        record_failure_for(&req.username.to_lowercase());
        return Err(StatusCode::UNAUTHORIZED);
    }
    let user_model = match user_model {
        Some(u) if enabled => u,
        _ => {
            record_failure_for(&key);
            record_failure_for(&req.username.to_lowercase());
            return Err(StatusCode::FORBIDDEN);
        }
    };

    // SEC-012: opportunistic migration of legacy unsalted SHA-256 to Argon2id.
    if !user_model.password_hash.starts_with("$argon2") {
        let new_hash = hash_password(&req.password);
        update_password_hash(&state.db, &user_model.id, &new_hash).await;
    }

    let user = User {
        id: user_model.id.clone(),
        username: user_model.username.clone(),
        role: UserRole::from_str(&user_model.role).unwrap_or(UserRole::Operator),
        email: user_model.email.clone(),
        enabled: user_model.enabled,
        tenant_id: user_model.tenant_id.clone(),
    };

    let token = state.jwt.generate(&user)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    update_last_login(&state.db, &user_model.id).await;

    // SEC-010: issue httpOnly cookie alongside Bearer JSON so the Web UI can
    // migrate off localStorage (XSS → token theft). Cookie is Lax, 24h.
    let cookie = format!("bck_token={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400", token);
    let body = serde_json::to_string(&LoginResponse { token, user })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let resp = axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::SET_COOKIE, cookie)
        .body(axum::body::Body::from(body))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(resp)
}

async fn logout(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let mut to_revoke: Vec<String> = Vec::new();
    if let Some(v) = headers.get(axum::http::header::AUTHORIZATION).and_then(|h| h.to_str().ok()).and_then(|s| s.strip_prefix("Bearer ")) {
        to_revoke.push(v.to_string());
    }
    // Also revoke cookie token.
    if let Some(raw) = headers.get(axum::http::header::COOKIE).and_then(|h| h.to_str().ok()) {
        for part in raw.split(';') {
            if let Some(v) = part.trim().strip_prefix("bck_token=") {
                if !v.is_empty() {
                    to_revoke.push(v.trim_matches('"').to_string());
                }
            }
        }
    }
    for v in &to_revoke {
        // In-memory fast path (current process).
        state.jwt.revoke(v);
        // SEC-003: persistent revocation so logout survives restarts.
        // Store only the hash, never the token itself.
        persist_revocation(&state.db, &state.jwt, v).await;
    }
    axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::SET_COOKIE, "bck_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
        .body(axum::body::Body::empty())
        .unwrap()
}

/// Record a token revocation in the DB (best-effort) and prune expired rows.
pub(crate) async fn persist_revocation(db: &DbPool, jwt: &crate::auth::jwt::JwtManager, token: &str) {
    use sha2::{Digest, Sha256};
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    // Token was just revoked in-memory, so `validate` would reject it —
    // decode the expiry directly (falls back to 24h on malformed tokens).
    let exp = jwt
        .expiry_of(token)
        .unwrap_or_else(|| chrono::Utc::now().timestamp() + 24 * 3600);
    match db {
        DbPool::Sqlite(pool) => {
            let _ = sqlx::query(
                "INSERT INTO revoked_tokens (token_hash, exp) VALUES (?1, ?2)
                 ON CONFLICT(token_hash) DO NOTHING",
            )
            .bind(&hash)
            .bind(exp)
            .execute(pool)
            .await;
            let now = chrono::Utc::now().timestamp();
            let _ = sqlx::query("DELETE FROM revoked_tokens WHERE exp <= ?1")
                .bind(now)
                .execute(pool)
                .await;
        }
        DbPool::Postgres(pool) => {
            let _ = sqlx::query(
                "INSERT INTO revoked_tokens (token_hash, exp) VALUES ($1, $2)
                 ON CONFLICT (token_hash) DO NOTHING",
            )
            .bind(&hash)
            .bind(exp)
            .execute(pool)
            .await;
            let now = chrono::Utc::now().timestamp();
            let _ = sqlx::query("DELETE FROM revoked_tokens WHERE exp <= $1")
                .bind(now)
                .execute(pool)
                .await;
        }
    }
}

/// Check the persistent revocation table (SEC-003). Returns true when revoked.
pub(crate) async fn is_persistently_revoked(db: &DbPool, token: &str) -> bool {
    use sha2::{Digest, Sha256};
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    match db {
        DbPool::Sqlite(pool) => sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM revoked_tokens WHERE token_hash = ?1",
        )
        .bind(&hash)
        .fetch_one(pool)
        .await
        .map(|c| c > 0)
        .unwrap_or(false),
        DbPool::Postgres(pool) => sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM revoked_tokens WHERE token_hash = $1",
        )
        .bind(&hash)
        .fetch_one(pool)
        .await
        .map(|c| c > 0)
        .unwrap_or(false),
    }
}

async fn me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<crate::auth::jwt::Claims>,
) -> Result<Json<User>, StatusCode> {
    if let Some(u) = find_user(&state.db, &claims.sub).await.ok().flatten() {
        return Ok(Json(User {
            id: u.id,
            username: u.username,
            role: UserRole::from_str(&u.role).unwrap_or(UserRole::Operator),
            email: u.email,
            enabled: u.enabled,
            tenant_id: u.tenant_id,
        }));
    }
    Err(StatusCode::UNAUTHORIZED)
}

async fn find_user(db: &DbPool, username_or_id: &str) -> anyhow::Result<Option<UserModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let row = sqlx::query_as::<_, UserModel>(
                "SELECT id, username, password_hash, email, role, enabled, last_login, created_at, updated_at, tenant_id
                 FROM users WHERE username = ?1 OR id = ?1"
            )
            .bind(username_or_id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
        DbPool::Postgres(pool) => {
            let row = sqlx::query_as::<_, UserModel>(
                "SELECT id, username, password_hash, email, role, enabled, last_login, created_at, updated_at, tenant_id
                 FROM users WHERE username = $1 OR id = $1"
            )
            .bind(username_or_id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
    }
}

async fn update_last_login(db: &DbPool, user_id: &str) {
    let t = chrono::Utc::now().timestamp();
    match db {
        DbPool::Sqlite(pool) => {
            let _ = sqlx::query("UPDATE users SET last_login = ?1 WHERE id = ?2")
                .bind(t)
                .bind(user_id)
                .execute(pool)
                .await;
        }
        DbPool::Postgres(pool) => {
            let _ = sqlx::query("UPDATE users SET last_login = $1 WHERE id = $2")
                .bind(t)
                .bind(user_id)
                .execute(pool)
                .await;
        }
    }
}

async fn update_password_hash(db: &DbPool, user_id: &str, new_hash: &str) {
    match db {
        DbPool::Sqlite(pool) => {
            let _ = sqlx::query("UPDATE users SET password_hash = ?1 WHERE id = ?2")
                .bind(new_hash)
                .bind(user_id)
                .execute(pool)
                .await;
        }
        DbPool::Postgres(pool) => {
            let _ = sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
                .bind(new_hash)
                .bind(user_id)
                .execute(pool)
                .await;
        }
    }
}
