use axum::{
    extract::{Query, State},
    Json,
    http::StatusCode,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::server::AppState;

#[derive(Deserialize)]
pub struct LogQuery {
    pub limit: Option<i64>,
    pub tail: Option<bool>,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_events))
}

async fn list_events(
    State(state): State<Arc<AppState>>,
    Query(params): Query<LogQuery>,
) -> Result<Json<Vec<crate::types::EventInfo>>, StatusCode> {
    let limit = params.limit.unwrap_or(50).min(500);
    let events = crate::db::list_events(&state.db, limit).await
        .map_err(|e| {
            tracing::error!("list events: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(events))
}
