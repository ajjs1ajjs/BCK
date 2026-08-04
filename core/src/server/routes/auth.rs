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

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/login", axum::routing::post(login))
        .route("/me", axum::routing::get(me))
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    let user = find_user(&state.db, &req.username).await;

    let user_model = match user {
        Ok(Some(u)) => {
            if !verify_password(&req.password, &u.password_hash) {
                return Err(StatusCode::UNAUTHORIZED);
            }
            if !u.enabled {
                return Err(StatusCode::FORBIDDEN);
            }
            u
        }
        // Auto-provision the default admin on first login.
        Ok(None) if req.username == "admin" && req.password == "admin" => {
            let t = chrono::Utc::now().timestamp();
            let id = "00000000-0000-0000-0000-000000000001".to_string();
            let hash = hash_password(&req.password);
            match &state.db {
                DbPool::Sqlite(pool) => {
                    sqlx::query(
                        "INSERT OR IGNORE INTO users (id, username, password_hash, role, enabled, created_at, updated_at)
                         VALUES (?1, ?2, ?3, 'admin', 1, ?4, ?4)"
                    )
                    .bind(&id)
                    .bind(&req.username)
                    .bind(&hash)
                    .bind(t)
                    .execute(pool)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
                DbPool::Postgres(pool) => {
                    sqlx::query(
                        "INSERT INTO users (id, username, password_hash, role, enabled, created_at, updated_at)
                         VALUES ($1, $2, $3, 'admin', 1, $4, $4)
                         ON CONFLICT (username) DO NOTHING"
                    )
                    .bind(&id)
                    .bind(&req.username)
                    .bind(&hash)
                    .bind(t)
                    .execute(pool)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
            UserModel {
                id,
                username: req.username.clone(),
                password_hash: hash,
                email: Some("admin@bck.local".into()),
                role: "admin".into(),
                enabled: true,
                last_login: None,
                created_at: t,
                updated_at: t,
            }
        }
        _ => return Err(StatusCode::UNAUTHORIZED),
    };

    let user = User {
        id: user_model.id.clone(),
        username: user_model.username.clone(),
        role: UserRole::from_str(&user_model.role).unwrap_or(UserRole::Operator),
        email: user_model.email.clone(),
        enabled: user_model.enabled,
    };

    let token = state.jwt.generate(&user)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    update_last_login(&state.db, &user_model.id).await;

    Ok(Json(LoginResponse { token, user }))
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
        }));
    }
    Err(StatusCode::UNAUTHORIZED)
}

async fn find_user(db: &DbPool, username_or_id: &str) -> anyhow::Result<Option<UserModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let row = sqlx::query_as::<_, UserModel>(
                "SELECT id, username, password_hash, email, role, enabled, last_login, created_at, updated_at
                 FROM users WHERE username = ?1 OR id = ?1"
            )
            .bind(username_or_id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
        DbPool::Postgres(pool) => {
            let row = sqlx::query_as::<_, UserModel>(
                "SELECT id, username, password_hash, email, role, enabled, last_login, created_at, updated_at
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
