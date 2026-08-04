use axum::{extract::State, Json};
use serde::Serialize;
use std::sync::Arc;

use crate::db::DbPool;
use crate::server::AppState;

#[derive(Serialize)]
pub struct DashboardStats {
    pub total_jobs: i64,
    pub active_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub total_repositories: i64,
    pub total_snapshots: i64,
    pub storage_used_bytes: i64,
    pub storage_free_bytes: i64,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/stats", axum::routing::get(get_stats))
}

async fn count(db: &DbPool, sql: &str) -> i64 {
    match db {
        DbPool::Sqlite(pool) => {
            sqlx::query_scalar::<_, i64>(sql).fetch_one(pool).await.unwrap_or(0)
        }
        DbPool::Postgres(pool) => {
            sqlx::query_scalar::<_, i64>(sql).fetch_one(pool).await.unwrap_or(0)
        }
    }
}

async fn get_stats(
    State(state): State<Arc<AppState>>,
) -> Json<DashboardStats> {
    let total_jobs = count(&state.db, "SELECT COUNT(*) FROM backup_jobs").await;
    let active_jobs = count(
        &state.db,
        "SELECT COUNT(*) FROM job_sessions WHERE status = 'running'",
    ).await;
    let completed_jobs = count(
        &state.db,
        "SELECT COUNT(*) FROM job_sessions WHERE status = 'completed'",
    ).await;
    let failed_jobs = count(
        &state.db,
        "SELECT COUNT(*) FROM job_sessions WHERE status = 'failed'",
    ).await;
    let total_repositories = count(&state.db, "SELECT COUNT(*) FROM repositories").await;
    let total_snapshots = count(&state.db, "SELECT COUNT(*) FROM snapshots").await;

    let storage_used_bytes = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(SUM(used_bytes), 0) FROM repositories",
            )
            .fetch_one(pool)
            .await
            .unwrap_or(0)
        }
        DbPool::Postgres(pool) => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(SUM(used_bytes), 0) FROM repositories",
            )
            .fetch_one(pool)
            .await
            .unwrap_or(0)
        }
    };

    let storage_free_bytes = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(SUM(free_bytes), 0) FROM repositories",
            )
            .fetch_one(pool)
            .await
            .unwrap_or(0)
        }
        DbPool::Postgres(pool) => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(SUM(free_bytes), 0) FROM repositories",
            )
            .fetch_one(pool)
            .await
            .unwrap_or(0)
        }
    };

    Json(DashboardStats {
        total_jobs,
        active_jobs,
        completed_jobs,
        failed_jobs,
        total_repositories,
        total_snapshots,
        storage_used_bytes,
        storage_free_bytes,
    })
}
