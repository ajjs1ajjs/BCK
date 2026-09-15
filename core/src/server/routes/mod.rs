pub mod jobs;
pub mod auth;
pub mod repositories;
pub mod snapshots;
pub mod restore;
pub mod dashboard;
pub mod hypervisors;
pub mod agents;
pub mod events;
pub mod sso;
pub mod sobr;
pub mod cloud;
pub mod m365;
pub mod tape;
pub mod cdp;
pub mod dr;
pub mod tenants;
pub mod portal;

#[cfg(test)]
pub mod testutil;

#[cfg(test)]
mod api_tests;

use axum::response::IntoResponse;
use std::sync::Arc;
use axum::Router;


use crate::server::AppState;

/// Bounded pagination for list endpoints (DoS guard: caps in-memory fan-out).
/// `?limit=&offset=` — limit capped at 1000, offset capped at 1M.
#[derive(serde::Deserialize, Default)]
pub struct Pagination {
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

impl Pagination {
    pub fn paginate<T>(&self, mut v: Vec<T>) -> Vec<T> {
        let limit = self.limit.unwrap_or(100).min(1000);
        let offset = self.offset.unwrap_or(0).min(1_000_000);
        if offset >= v.len() {
            return Vec::new();
        }
        v.drain(..offset);
        v.truncate(limit);
        v
    }
}

/// Routes that do not require authentication.
pub fn public_api_routes(state: Arc<AppState>) -> Router {
    Router::new()
        .without_v07_checks()
        .nest("/auth", auth::router())
        .nest("/auth/sso", sso::public_router())
        // Agent endpoints are authenticated with the pre-shared agent token
        // (not a user JWT), so they live outside the user-auth router but are
        // still gated — previously anyone could poll/inject agent tasks.
        .nest("/agents", axum::Router::new()
            .without_v07_checks()
            .route("/heartbeat", axum::routing::post(agents::heartbeat))
            .route("/{id}/tasks/pending", axum::routing::get(agents::poll_pending_tasks))
            .route("/{id}/tasks/{task_id}/report", axum::routing::post(agents::report_task_status))
            .route_layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::server::middleware::agent_auth::agent_auth_middleware,
            )))
        .with_state(state)
}

/// Routes that require a valid JWT.
pub fn protected_api_routes(state: Arc<AppState>) -> Router {
    Router::new()
        .without_v07_checks()
        .nest("/jobs", jobs::router())
        .nest("/repositories", repositories::router())
        .nest("/snapshots", snapshots::router())
        .nest("/restore", restore::router())
        .nest("/dashboard", dashboard::router())
        .nest("/hypervisors", hypervisors::router())
        .nest("/events", events::router())
        .nest("/agents", agents::router())
        .nest("/auth", auth::protected_router())
        .nest("/auth/sso", sso::protected_router())
        .nest("/sobr", sobr::router())
        .nest("/cloud", cloud::router())
        .nest("/m365", m365::router())
        .nest("/tape", tape::router())
        .nest("/cdp", cdp::router())
        .nest("/dr", dr::router())
        .nest("/tenants", tenants::router())
        .nest("/portal", portal::router())
        .route_layer(axum::middleware::from_fn_with_state(state.clone(), crate::server::middleware::auth::auth_middleware))
        .with_state(state)
}

pub fn api_routes(state: Arc<AppState>) -> Router {
    let protected = protected_api_routes(state.clone());
    let public = public_api_routes(state.clone());
    // Liveness/readiness probe (no auth): checks DB connectivity.
    let health = Router::new()
        .route("/healthz", axum::routing::get(healthz))
        .route("/metrics", axum::routing::get(metrics))
        .with_state(state);
    Router::new()
        .merge(protected)
        .merge(public)
        .merge(health)
}

async fn healthz(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> axum::response::Response {
    let db_ok = match &state.db {
        crate::db::DbPool::Sqlite(pool) => sqlx::query("SELECT 1").fetch_one(pool).await.is_ok(),
        crate::db::DbPool::Postgres(pool) => sqlx::query("SELECT 1").fetch_one(pool).await.is_ok(),
    };
    let leader = *state.is_leader.read().await;
    if db_ok {
        (axum::http::StatusCode::OK, axum::Json(serde_json::json!({"status":"ok","leader":leader,"node":state.ha_node.id}))).into_response()
    } else {
        (axum::http::StatusCode::SERVICE_UNAVAILABLE, axum::Json(serde_json::json!({"status":"degraded","db":"unreachable","leader":leader}))).into_response()
    }
}

async fn metrics(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    // SEC: /metrics requires auth (Bearer or cookie) to avoid leaking job
    // counts to unauthenticated scrapers. Monitoring uses a Viewer+ token.
    // Health (/healthz) stays public for load-balancer probes.
    let authed = {
        let bearer = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|s| s.to_string());
        let cookie = headers.get(axum::http::header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .and_then(|raw| {
                raw.split(';').find_map(|p| {
                    p.trim().strip_prefix("bck_token=").map(|s| s.trim_matches('"').to_string())
                })
            });
        match bearer.or(cookie) {
            Some(t) => state.jwt.validate(&t).is_ok()
                && !crate::server::routes::auth::is_persistently_revoked(&state.db, &t).await,
            None => false,
        }
    };
    if !authed {
        return (axum::http::StatusCode::UNAUTHORIZED, "metrics require authentication").into_response();
    }
    // PERF: single aggregated query path — list_jobs already batches; avoid
    // per-job view_of N+1 by counting status directly.
    let jobs = {
        let jm = state.job_manager.lock().await;
        jm.list_jobs().await.unwrap_or_default()
    };
    let running = jobs.iter().filter(|j| j.status == "running").count();
    let failed = jobs.iter().filter(|j| j.status.starts_with("failed")).count();
    // P1 SLO inputs (10/10): snapshot/restore/event counters from DB.
    let (snapshots, restores_ok, restores_fail) = match &state.db {
        crate::db::DbPool::Sqlite(pool) => {
            let s: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM snapshots").fetch_one(pool).await.unwrap_or(0);
            let rok: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE event_type = 'restore_completed'").fetch_one(pool).await.unwrap_or(0);
            let rfail: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE message LIKE '%fail%'").fetch_one(pool).await.unwrap_or(0);
            (s, rok, rfail)
        }
        crate::db::DbPool::Postgres(pool) => {
            let s: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM snapshots").fetch_one(pool).await.unwrap_or(0);
            let rok: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE event_type = 'restore_completed'").fetch_one(pool).await.unwrap_or(0);
            let rfail: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE message LIKE '%fail%'").fetch_one(pool).await.unwrap_or(0);
            (s, rok, rfail)
        }
    };
    let body = format!(
        "# HELP bck_jobs_total Total jobs\n# TYPE bck_jobs_total gauge\nbck_jobs_total {}\n# HELP bck_jobs_running Running jobs\n# TYPE bck_jobs_running gauge\nbck_jobs_running {}\n# HELP bck_jobs_failed Failed jobs\n# TYPE bck_jobs_failed gauge\nbck_jobs_failed {}\n# HELP bck_snapshots_total Total snapshots\n# TYPE bck_snapshots_total gauge\nbck_snapshots_total {}\n# HELP bck_restores_completed_total Completed restores\n# TYPE bck_restores_completed_total counter\nbck_restores_completed_total {}\n# HELP bck_restores_failed_total Failed restores\n# TYPE bck_restores_failed_total counter\nbck_restores_failed_total {}\n",
        jobs.len(),
        running,
        failed,
        snapshots,
        restores_ok,
        restores_fail,
    );
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        body,
    )
        .into_response()
}
