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

#[cfg(test)]
pub mod testutil;

#[cfg(test)]
mod api_tests;

use axum::Router;
use std::sync::Arc;

use crate::server::AppState;

/// Routes that do not require authentication.
pub fn public_api_routes(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/auth", auth::router())
        .nest("/auth/sso", sso::public_router())
        .nest("/agents", axum::Router::new()
            .route("/heartbeat", axum::routing::post(agents::heartbeat))
            .route("/:id/tasks/pending", axum::routing::get(agents::poll_pending_tasks))
            .route("/:id/tasks/:task_id/report", axum::routing::post(agents::report_task_status)))
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
        .nest("/auth/sso", sso::protected_router())
        .nest("/sobr", sobr::router())
        .nest("/cloud", cloud::router())
        .nest("/m365", m365::router())
        .nest("/tape", tape::router())
        .nest("/cdp", cdp::router())
        .nest("/dr", dr::router())
        .route_layer(axum::middleware::from_fn_with_state(state.clone(), crate::server::middleware::auth::auth_middleware))
        .with_state(state)
}

pub fn api_routes(state: Arc<AppState>) -> Router {
    let protected = protected_api_routes(state.clone());
    let public = public_api_routes(state);
    Router::new()
        .merge(protected)
        .merge(public)
}
