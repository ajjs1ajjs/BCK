use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::server::AppState;

/// Authenticates agent-to-server calls via either:
/// 1. Agent JWT (`role == "agent"`, issued by heartbeat), or
/// 2. The pre-shared agent token — heartbeat registration ONLY (SEC-003).
///    Poll/report require the per-agent JWT so a leaked shared secret cannot
///    impersonate arbitrary agent_ids.
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

    // Path 1: agent JWT.
    if let Ok(claims) = state.jwt.validate(token) {
        if claims.role == "agent" && !claims.sub.is_empty() {
            let mut req = req;
            req.extensions_mut().insert(claims);
            return Ok(next.run(req).await);
        }
    }

    // SEC-003: pre-shared token is valid ONLY for heartbeat (registration).
    // Poll/report endpoints require the per-agent JWT issued at heartbeat
    // (sub = agent_id, short exp). This binds the shared secret to enrollment
    // and prevents impersonation of any agent_id via path synthesis.
    let is_heartbeat = req.uri().path().ends_with("/heartbeat");
    if !is_heartbeat {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Path 2: pre-shared token (constant-time compare, no length oracle).
    let expected = state.agent_token.as_deref().unwrap_or("");
    if expected.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let (exp, got) = (expected.as_bytes(), token.as_bytes());
    let mut diff = (exp.len() ^ got.len()) as u8;
    for i in 0..exp.len() {
        diff |= exp[i] ^ *got.get(i).unwrap_or(&0);
    }
    if diff != 0 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    // Shared secret is valid, heartbeat only. Synthesize minimal claims.
    // Poll/report already returned 401 above without a valid agent JWT.
    let claims = Claims {
        sub: String::new(),
        username: "agent".into(),
        role: "agent".into(),
        exp: usize::MAX,
        iat: 0,
        tenant_id: None,
    };

    // Inject agent claims into request extensions for use by handlers
    let mut req = req;
    req.extensions_mut().insert(claims);

    Ok(next.run(req).await)
}
