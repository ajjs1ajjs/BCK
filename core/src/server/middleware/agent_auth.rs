use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::server::AppState;
use crate::db::DbPool;

/// Authenticates agent-to-server calls with JWT tokens
/// (`Authorization: Bearer <agent_jwt_token>`). Each agent has its own JWT
/// token issued during registration/heartbeat containing agent-specific claims.
pub async fn agent_auth_middleware(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let token = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Validate the JWT token using the server's JWT secret
    let claims: Claims = state
        .jwt
        .validate(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Verify this is an agent token (not a user token)
    if claims.role != "agent" {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Extract agent ID from token subject
    let agent_id = &claims.sub;
    if agent_id.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Optional: Verify agent exists in database and is active
    let agent_exists = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query("SELECT 1 FROM agents WHERE id = ?1 AND status = 'online'")
                .bind(agent_id)
                .fetch_optional(pool)
                .await
                .map(|opt| opt.is_some())
                .unwrap_or(false)
        }
        DbPool::Postgres(pool) => {
            sqlx::query("SELECT 1 FROM agents WHERE id = $1 AND status = 'online'")
                .bind(agent_id)
                .fetch_optional(pool)
                .await
                .map(|opt| opt.is_some())
                .unwrap_or(false)
        }
    };

    if !agent_exists {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Inject agent claims into request extensions for use by handlers
    let mut req = req;
    req.extensions_mut().insert(claims);
    
    Ok(next.run(req).await)
}
