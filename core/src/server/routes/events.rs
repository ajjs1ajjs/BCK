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
    // Tenant-scoped callers see only events for their own jobs (or global events with no job_id).
    let filtered = if claims.role == "super_admin" || claims.tenant_id.is_none() {
        events
    } else {
        let tenant = claims.tenant_id.as_deref().unwrap();
        let mut out = Vec::new();
        for ev in events {
            if let Some(job_id) = ev.job_id.as_deref() {
                // Check if job belongs to tenant — best-effort, skip if lookup fails.
                let belongs = match &state.db {
                    crate::db::DbPool::Sqlite(pool) => {
                        sqlx::query_scalar::<_, Option<String>>("SELECT tenant_id FROM backup_jobs WHERE id = ?1")
                            .bind(job_id).fetch_optional(pool).await.ok().flatten().flatten()
                    }
                    crate::db::DbPool::Postgres(pool) => {
                        sqlx::query_scalar::<_, Option<String>>("SELECT tenant_id FROM backup_jobs WHERE id = $1")
                            .bind(job_id).fetch_optional(pool).await.ok().flatten().flatten()
                    }
                };
                if belongs.as_deref() == Some(tenant) {
                    out.push(ev);
                }
            }
            // Global events (no job_id) are hidden from tenant-scoped callers.
        }
        out
    };
    Ok(Json(filtered))
}
