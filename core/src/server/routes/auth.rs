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

// --- login rate limiting (in-memory, per-username) ---

const MAX_FAILED_ATTEMPTS: usize = 10;
const FAILURE_WINDOW_SECS: i64 = 300;

/// Rolling window of failed-login timestamps per username.
fn login_attempts() -> &'static dashmap::DashMap<String, Vec<i64>> {
    static MAP: std::sync::OnceLock<dashmap::DashMap<String, Vec<i64>>> = std::sync::OnceLock::new();
    MAP.get_or_init(dashmap::DashMap::new)
}

fn rate_limited(username: &str) -> bool {
    let now = chrono::Utc::now().timestamp();
    let mut entry = login_attempts().entry(username.to_lowercase()).or_default();
    entry.retain(|&t| now - t < FAILURE_WINDOW_SECS);
    entry.len() >= MAX_FAILED_ATTEMPTS
}

fn record_failure(username: &str) {
    let now = chrono::Utc::now().timestamp();
    login_attempts().entry(username.to_lowercase()).or_default().push(now);
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
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    if rate_limited(&req.username) {
        tracing::warn!("login rate limit hit for user {}", req.username);
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
        record_failure(&req.username);
        return Err(StatusCode::UNAUTHORIZED);
    }
    let user_model = match user_model {
        Some(u) if enabled => u,
        _ => {
            record_failure(&req.username);
            return Err(StatusCode::FORBIDDEN);
        }
    };

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

    Ok(Json(LoginResponse { token, user }))
}

async fn logout(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> StatusCode {
    if let Some(v) = headers.get(axum::http::header::AUTHORIZATION).and_then(|h| h.to_str().ok()).and_then(|s| s.strip_prefix("Bearer ")) {
        state.jwt.revoke(v);
    }
    StatusCode::OK
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
