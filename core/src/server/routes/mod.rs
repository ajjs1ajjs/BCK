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
use axum::Router;
use std::sync::Arc;

use crate::server::AppState;

/// Routes that do not require authentication.
pub fn public_api_routes(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/auth", auth::router())
        .nest("/auth/sso", sso::public_router())
        // Agent endpoints are authenticated with the pre-shared agent token
        // (not a user JWT), so they live outside the user-auth router but are
        // still gated — previously anyone could poll/inject agent tasks.
        .nest("/agents", axum::Router::new()
            .route("/heartbeat", axum::routing::post(agents::heartbeat))
            .route("/:id/tasks/pending", axum::routing::get(agents::poll_pending_tasks))
            .route("/:id/tasks/:task_id/report", axum::routing::post(agents::report_task_status))
            .route_layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::server::middleware::agent_auth::agent_auth_middleware,
            )))
        .with_state(state)
}

/// Routes that require a valid JWT.
pub fn protected_api_routes(state: Arc<AppState>) -> Router {
    Router::new()
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
    if db_ok {
        (axum::http::StatusCode::OK, axum::Json(serde_json::json!({"status":"ok"}))).into_response()
    } else {
        (axum::http::StatusCode::SERVICE_UNAVAILABLE, axum::Json(serde_json::json!({"status":"degraded","db":"unreachable"}))).into_response()
    }
}

async fn metrics(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> axum::response::Response {
    // Simple Prometheus-style metrics (no auth, scraped by monitoring).
    let jobs = {
        let jm = state.job_manager.lock().await;
        jm.list_jobs().await.unwrap_or_default()
    };
    let running = jobs.iter().filter(|j| j.status == "running").count();
    let body = format!(
        "# HELP bck_jobs_total Total jobs\n# TYPE bck_jobs_total gauge\nbck_jobs_total {}\n# HELP bck_jobs_running Running jobs\n# TYPE bck_jobs_running gauge\nbck_jobs_running {}\n",
        jobs.len(),
        running
    );
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        body,
    )
        .into_response()
}
