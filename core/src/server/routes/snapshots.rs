use axum::{
    extract::{Extension, Path, Query, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::db::models::snapshot::SnapshotModel;
use crate::db::DbPool;
use crate::server::AppState;

#[derive(Serialize)]
pub struct SnapshotResponse {
    pub id: String,
    pub job_id: String,
    pub repository_id: String,
    pub snapshot_type: String,
    pub parent_id: Option<String>,
    pub size_bytes: i64,
    pub unique_bytes: i64,
    pub compressed_bytes: i64,
    pub checksum: String,
    pub consistency: String,
    pub app_consistent: bool,
    pub created_at: i64,
}

impl From<SnapshotModel> for SnapshotResponse {
    fn from(s: SnapshotModel) -> Self {
        Self {
            id: s.id,
            job_id: s.job_id,
            repository_id: s.repository_id,
            snapshot_type: s.snapshot_type,
            parent_id: s.parent_id,
            size_bytes: s.size_bytes,
            unique_bytes: s.unique_bytes,
            compressed_bytes: s.compressed_bytes,
            checksum: s.checksum,
            consistency: s.consistency,
            app_consistent: s.app_consistent,
            created_at: s.created_at,
        }
    }
}

#[derive(Deserialize)]
pub struct SnapshotQueryParams {
    pub job_id: Option<String>,
    pub limit: Option<i64>,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_snapshots))
        .route("/:id", axum::routing::get(get_snapshot).delete(delete_snapshot))
}

fn tenant_allows(claims: &Claims, owner: Option<&str>) -> bool {
    if claims.role == "super_admin" {
        return true;
    }
    match &claims.tenant_id {
        None => true,
        Some(mine) => owner == Some(mine.as_str()),
    }
}

async fn list_snapshots(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SnapshotQueryParams>,
) -> Result<Json<Vec<SnapshotResponse>>, StatusCode> {
    let limit = params.limit.unwrap_or(100).min(1000);
    let snapshots = fetch_snapshots(&state.db, params.job_id.as_deref(), limit).await
        .map_err(|e| {
            tracing::error!("list snapshots: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .into_iter()
        .filter(|s| tenant_allows(&claims, s.tenant_id.as_deref()))
        .map(SnapshotResponse::from)
        .collect();
    Ok(Json(snapshots))
}

async fn get_snapshot(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<SnapshotResponse>, StatusCode> {
    let snapshot = fetch_snapshot(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter(|s| tenant_allows(&claims, s.tenant_id.as_deref()))
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(SnapshotResponse::from(snapshot)))
}

async fn delete_snapshot(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Resolve the snapshot first so we can GC its blocks against the right
    // repository, and verify the caller's tenant owns it.
    let snapshot = fetch_snapshot(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter(|s| tenant_allows(&claims, s.tenant_id.as_deref()))
        .ok_or(StatusCode::NOT_FOUND)?;

    state.job_manager.lock().await
        .delete_snapshot_with_gc(&id, &snapshot.repository_id)
        .await
        .map_err(|e| {
            tracing::error!("delete snapshot with gc: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    crate::db::record_event(
        &state.db,
        "snapshot_deleted",
        "snapshots",
        &format!("Snapshot {} deleted", id),
        None,
        None,
    ).await.ok();
    Ok(StatusCode::NO_CONTENT)
}

pub async fn fetch_snapshots(db: &DbPool, job_id: Option<&str>, limit: i64) -> anyhow::Result<Vec<SnapshotModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = match job_id {
                Some(jid) => {
                    sqlx::query_as::<_, SnapshotModel>(
                        "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                                size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                                app_consistent, created_at, tenant_id
                         FROM snapshots WHERE job_id = ?1 ORDER BY created_at DESC LIMIT ?2"
                    )
                    .bind(jid)
                    .bind(limit)
                    .fetch_all(pool)
                    .await?
                }
                None => {
                    sqlx::query_as::<_, SnapshotModel>(
                        "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                                size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                                app_consistent, created_at, tenant_id
                         FROM snapshots ORDER BY created_at DESC LIMIT ?1"
                    )
                    .bind(limit)
                    .fetch_all(pool)
                    .await?
                }
            };
            Ok(rows)
        }
        DbPool::Postgres(pool) => {
            let rows = match job_id {
                Some(jid) => {
                    sqlx::query_as::<_, SnapshotModel>(
                        "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                                size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                                app_consistent, created_at, tenant_id
                         FROM snapshots WHERE job_id = $1 ORDER BY created_at DESC LIMIT $2"
                    )
                    .bind(jid)
                    .bind(limit)
                    .fetch_all(pool)
                    .await?
                }
                None => {
                    sqlx::query_as::<_, SnapshotModel>(
                        "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                                size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                                app_consistent, created_at, tenant_id
                         FROM snapshots ORDER BY created_at DESC LIMIT $1"
                    )
                    .bind(limit)
                    .fetch_all(pool)
                    .await?
                }
            };
            Ok(rows)
        }
    }
}

pub async fn fetch_snapshot(db: &DbPool, id: &str) -> anyhow::Result<Option<SnapshotModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let row = sqlx::query_as::<_, SnapshotModel>(
                "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                        size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                        app_consistent, created_at, tenant_id
                 FROM snapshots WHERE id = ?1"
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
        DbPool::Postgres(pool) => {
            let row = sqlx::query_as::<_, SnapshotModel>(
                "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                        size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                        app_consistent, created_at, tenant_id
                 FROM snapshots WHERE id = $1"
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
    }
}
