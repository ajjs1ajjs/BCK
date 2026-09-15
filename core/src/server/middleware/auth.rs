use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::auth::policy::{
    can_manage_agents, can_manage_dr, can_manage_hypervisors, can_mutate, can_restore,
    is_global_admin, tenant_allows,
};
use crate::server::AppState;

/// JWT-based authentication and role-based access control middleware.
///
/// Reads (GET/HEAD/OPTIONS) are allowed for any authenticated user, with
/// stricter role checks on sensitive surfaces (events, restore, agent
/// metadata, admin surfaces). Mutations require at least Operator; restore
/// operations allow RestoreOperator; admin/tenant/DR management is admin-only.
///
/// Authorization is now driven by the typed `UserRole` enum in
/// `crate::auth::policy`, not by string-equality on `claims.role`. This closes
/// the cross-tenant bypass where a token whose `role` claim was
/// `"super_admin"` would skip tenant checks.
pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // SEC-010: accept Bearer header (primary) or httpOnly `bck_token` cookie
    // (XSS-hardened alternative). Cookie is checked only when no Bearer is
    // present so existing CLI/Bearer flows keep working.
    let token_owned: String = match req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        Some(t) => t.to_string(),
        None => match cookie_token(req.headers()) {
            Some(c) => c,
            None => return Err(StatusCode::UNAUTHORIZED),
        },
    };
    let token = token_owned.as_str();

    let claims: Claims = state
        .jwt
        .validate(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // SEC-003: persistent revocation (survives restarts; the in-memory map in
    // JwtManager is only a fast path).
    if crate::server::routes::auth::is_persistently_revoked(&state.db, token).await {
        return Err(StatusCode::UNAUTHORIZED);
    }

    if matches!(
        req.method(),
        &Method::GET | &Method::HEAD | &Method::OPTIONS
    ) {
        let path = req.uri().path();
        let role = claims.role.as_str();
        // tenant scope: cross-tenant calls (e.g. /api/tenants/:id) need an
        // explicit tenant_allows check inside the handler; here we only gate
        // the role floor.

        // Restore data-plane reads + audit/events require restore capability.
        if path.contains("/restore/explore")
            || path.contains("/restore/instant")
            || path.contains("/restore/surebackup")
            || seg(path, "events")
        {
            if !can_restore(&claims) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // Cloud / M365 configs are sensitive (they serialize secrets); keep
        // them behind a restore-capable role.
        if seg(path, "cloud") || seg(path, "m365") {
            if !can_restore(&claims) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // Agent metadata may contain encryption material; admin only.
        if seg(path, "agents") {
            if !can_manage_agents(&claims) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // Hypervisors expose infrastructure; operator floor.
        if seg(path, "hypervisors") {
            if !can_manage_hypervisors(&claims) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // Tenancy, admin portal, SSO provider management: admin only.
        if seg(path, "tenants") || path.contains("/portal/admin") || path.contains("/auth/sso/providers") {
            if !is_global_admin(&claims) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // DR read endpoints require DR manager.
        if seg(path, "dr") {
            if !can_manage_dr(&claims) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        // silence unused warning for role (kept for future per-method checks)
        let _ = role;
        // Keep tenant_allows reference to avoid unused-import warnings when
        // no path is matched (function is exported through the policy module
        // for use by individual handlers).
        let _ = tenant_allows;

        req.extensions_mut().insert(claims);
        return Ok(next.run(req).await);
    }

    // --- mutations ---
    let path = req.uri().path();

    // Admin-only management surfaces.
    if seg(path, "tenants")
        || path.contains("/portal/admin")
        || path.contains("/auth/sso")
    {
        if !is_global_admin(&claims) {
            return Err(StatusCode::FORBIDDEN);
        }
    } else if seg(path, "dr") {
        // DR mutations (failover, failback, register site/plan) are admin only.
        if !can_execute_dr_path(&claims, path) {
            return Err(StatusCode::FORBIDDEN);
        }
    } else if seg(path, "agents") {
        // Agent management (delete, create task) requires admin.
        if !can_manage_agents(&claims) {
            return Err(StatusCode::FORBIDDEN);
        }
    } else if seg(path, "hypervisors") {
        // Adding/deleting hypervisors requires operator+.
        if !can_manage_hypervisors(&claims) {
            return Err(StatusCode::FORBIDDEN);
        }
    } else if path.contains("/restore")
        || seg(path, "instant")
        || seg(path, "surebackup")
        || path.contains("/portal/restore-requests")
    {
        // Restore operations: Operator and RestoreOperator are allowed.
        if !can_restore(&claims) {
            return Err(StatusCode::FORBIDDEN);
        }
    } else if !can_mutate(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }

    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}

/// Extract `bck_token` from Cookie header without extra deps.
fn cookie_token(headers: &axum::http::HeaderMap) -> Option<String> {
    let raw = headers.get(axum::http::header::COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        let part = part.trim();
        if let Some(v) = part.strip_prefix("bck_token=") {
            let v = v.trim().trim_matches('"');
            if !v.is_empty() && v.len() <= 8192 {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// Segment-aware path matcher: avoids over-matching of `contains`
/// (e.g. `/dr` must not match `/api/v1/dropbox`). Paths are expected as
/// `/api/v1/<resource>...`; we match on the resource segment.
fn seg(path: &str, name: &str) -> bool {
    path.split('/').any(|s| s == name)
}

#[allow(dead_code)]
fn seg_any(path: &str, names: &[&str]) -> bool {
    path.split('/').any(|s| names.contains(&s))
}

fn can_execute_dr_path(claims: &crate::auth::jwt::Claims, path: &str) -> bool {
    use crate::auth::policy::{can_manage_dr, role_of};
    use crate::auth::UserRole;
    if path.contains("/dr/sites") || path.contains("/dr/plans") {
        // POST is registration/creation.
        return can_manage_dr(claims);
    }
    if path.contains("/failover") || path.contains("/failback") || path.contains("/test") {
        let r = role_of(claims);
        return matches!(
            r,
            UserRole::SuperAdmin | UserRole::Admin | UserRole::Operator
        );
    }
    can_manage_dr(claims)
}
