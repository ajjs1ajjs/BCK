use axum::{
    extract::{Extension, Query, State},
    Json,
    http::StatusCode,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::auth::jwt::Claims;
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
    Extension(claims): Extension<Claims>,
    Query(params): Query<LogQuery>,
) -> Result<Json<Vec<crate::types::EventInfo>>, StatusCode> {
    let limit = params.limit.unwrap_or(50).min(500);
    let events = crate::db::list_events(&state.db, limit).await
        .map_err(|e| {
            tracing::error!("list events: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    // Tenant-scoped callers see only events for their own jobs (no N+1: single batch lookup).
    let filtered = if claims.role == "super_admin" || claims.tenant_id.is_none() {
        events
    } else {
        let tenant = claims.tenant_id.as_deref().unwrap();
        let job_ids: Vec<String> = events.iter().filter_map(|e| e.job_id.clone()).collect();
        let tenant_map: std::collections::HashMap<String, Option<String>> = if job_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            match &state.db {
                crate::db::DbPool::Sqlite(pool) => {
                    // Build IN clause dynamically (sqlite has no array param)
                    let placeholders = job_ids.iter().enumerate().map(|(i, _)| format!("?{}", i+1)).collect::<Vec<_>>().join(",");
                    let sql = format!("SELECT id, tenant_id FROM backup_jobs WHERE id IN ({})", placeholders);
                    let mut q = sqlx::query_as::<_, (String, Option<String>)>(&sql);
                    for id in &job_ids { q = q.bind(id); }
                    q.fetch_all(pool).await.unwrap_or_default().into_iter().collect()
                }
                crate::db::DbPool::Postgres(pool) => {
                    sqlx::query_as::<_, (String, Option<String>)>("SELECT id, tenant_id FROM backup_jobs WHERE id = ANY($1)")
                        .bind(&job_ids).fetch_all(pool).await.unwrap_or_default().into_iter().collect()
                }
            }
        };
        events.into_iter().filter(|ev| {
            if let Some(job_id) = ev.job_id.as_deref() {
                tenant_map.get(job_id).map(|t| t.as_deref() == Some(tenant)).unwrap_or(false)
            } else { false }
        }).collect()
    };
    Ok(Json(filtered))
}
