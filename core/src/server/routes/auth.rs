use axum::{extract::State, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::server::AppState;
use crate::auth::{User, UserRole};

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
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    // TODO: query user from database and verify
    // For now, accept default admin/admin
    if req.username != "admin" || req.password != "admin" {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user = User {
        id: "00000000-0000-0000-0000-000000000001".into(),
        username: "admin".into(),
        role: UserRole::Admin,
        email: Some("admin@bck.local".into()),
        enabled: true,
    };

    let token = state.jwt.generate(&user)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(LoginResponse { token, user }))
}
