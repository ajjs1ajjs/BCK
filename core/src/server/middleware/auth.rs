use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::server::AppState;

/// Role ranking for authorization decisions. Higher is more privileged.
/// "api" tokens (service accounts generated via generate_api_token) are treated
/// as admins.
fn role_rank(role: &str) -> u8 {
    match role {
        "super_admin" => 100,
        "admin" | "api" => 80,
        "operator" => 60,
        "restore_operator" => 55,
        "viewer" => 40,
        _ => 0,
    }
}

fn is_admin(role: &str) -> bool {
    role_rank(role) >= 80
}

fn can_mutate(role: &str) -> bool {
    role_rank(role) >= 60
}

fn can_restore(role: &str) -> bool {
    role_rank(role) >= 55
}

/// Validates the JWT and enforces role-based access control. Read-only requests
/// are allowed for any authenticated user; mutations require at least Operator
/// (restore mutations allow RestoreOperator; tenant/admin management requires
/// Admin/SuperAdmin).
pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let token = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let claims: Claims = state.jwt.validate(token).map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Reads are allowed for any authenticated user EXCEPT on sensitive surfaces
    // that expose backup data, infrastructure details or credentials. Those are
    // gated by role just like mutations.
    if matches!(req.method(), &Method::GET | &Method::HEAD | &Method::OPTIONS) {
        let role = claims.role.as_str();
        let path = req.uri().path();

        // Restore data-plane reads (file download / browse, instant recovery,
        // surebackup) and audit/events require restore capability.
        if path.contains("/restore/explore")
            || path.contains("/restore/instant")
            || path.contains("/restore/surebackup")
            || path.contains("/events")
        {
            if !can_restore(role) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // Cloud / M365 configs are sensitive (they used to serialize secrets);
        // keep them behind a restore-capable role.
        if path.contains("/cloud") || path.contains("/m365") {
            if !can_restore(role) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // Agent metadata and task payloads may contain encryption material.
        if path.contains("/agents") {
            if !can_mutate(role) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // Tenancy, admin portal and SSO provider management are admin-only.
        if path.contains("/tenants") || path.contains("/portal/admin") || path.contains("/auth/sso/providers") {
            if !is_admin(role) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        req.extensions_mut().insert(claims);
        return Ok(next.run(req).await);
    }

    // Mutations below are checked against the user's role.
    let role = claims.role.as_str();
    let path = req.uri().path();

    // Admin-only management surfaces.
    if path.contains("/tenants") || path.contains("/portal/admin") {
        if !is_admin(role) {
            return Err(StatusCode::FORBIDDEN);
        }
    } else if path.contains("/restore")
        || path.contains("/instant")
        || path.contains("/surebackup")
        || path.contains("/portal/restore-requests")
    {
        // Restore operations: Operator and RestoreOperator are allowed.
        if !can_restore(role) {
            return Err(StatusCode::FORBIDDEN);
        }
    } else if !can_mutate(role) {
        // Everything else that mutates state requires at least Operator.
        return Err(StatusCode::FORBIDDEN);
    }

    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}
