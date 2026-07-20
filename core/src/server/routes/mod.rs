pub mod jobs;
pub mod auth;
pub mod repositories;
pub mod snapshots;
pub mod restore;
pub mod dashboard;
pub mod hypervisors;

use axum::Router;
use std::sync::Arc;

use crate::server::AppState;

pub fn api_routes(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/auth", auth::router())
        .nest("/jobs", jobs::router())
        .nest("/repositories", repositories::router())
        .nest("/snapshots", snapshots::router())
        .nest("/restore", restore::router())
        .nest("/dashboard", dashboard::router())
        .nest("/hypervisors", hypervisors::router())
        .with_state(state)
}
