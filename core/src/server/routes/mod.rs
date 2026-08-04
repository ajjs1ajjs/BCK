pub mod jobs;
pub mod auth;
pub mod repositories;
pub mod snapshots;
pub mod restore;
pub mod dashboard;
pub mod hypervisors;
pub mod agents;
pub mod events;

use axum::Router;
use std::sync::Arc;

use crate::server::AppState;

/// Routes that do not require authentication.
pub fn public_api_routes(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/auth", auth::router())
        .nest("/agents", axum::Router::new()
            .route("/heartbeat", axum::routing::post(agents::heartbeat)))
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
