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

/// Authenticates agent-to-server calls via either:
/// 1. Agent JWT (`role == "agent"`, issued by heartbeat), or
/// 2. The pre-shared agent token (heartbeat registration + polling with the
///    shared secret — path id is taken at face value, see BUG-023/024 note
///    in `poll_pending_tasks`).
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
    // Shared secret is valid. Synthesize agent claims from the request path
    // so downstream handlers that require `Extension<Claims>` keep working.
    // NOTE: this middleware runs inside the nested `/agents` router, so the
    // visible path is already stripped (`/{id}/tasks/pending`, `/heartbeat`).
    // The agent id is the FIRST segment (not nth(1)).
    let segs: Vec<&str> = req
        .uri()
        .path()
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let agent_id = if segs.first() == Some(&"agents") {
        segs.get(1).unwrap_or(&"").to_string()
    } else {
        segs.first().unwrap_or(&"").to_string()
    };
    let claims = Claims {
        sub: agent_id.clone(),
        username: "agent".into(),
        role: "agent".into(),
        exp: usize::MAX,
        iat: 0,
        tenant_id: None,
    };

    // Heartbeat registers the agent, so it cannot require a pre-existing
    // online row. Poll/report endpoints do require it.
    let is_heartbeat = req.uri().path().ends_with("/heartbeat");
    if !is_heartbeat && !agent_id.is_empty() && agent_id != "heartbeat" {
        let agent_exists = match &state.db {
            DbPool::Sqlite(pool) => {
                sqlx::query("SELECT 1 FROM agents WHERE id = ?1 AND status = 'online'")
                    .bind(&agent_id)
                    .fetch_optional(pool)
                    .await
                    .map(|opt| opt.is_some())
                    .unwrap_or(false)
            }
            DbPool::Postgres(pool) => {
                sqlx::query("SELECT 1 FROM agents WHERE id = $1 AND status = 'online'")
                    .bind(&agent_id)
                    .fetch_optional(pool)
                    .await
                    .map(|opt| opt.is_some())
                    .unwrap_or(false)
            }
        };
        if !agent_exists {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }

    // Inject agent claims into request extensions for use by handlers
    let mut req = req;
    req.extensions_mut().insert(claims);

    Ok(next.run(req).await)
}
