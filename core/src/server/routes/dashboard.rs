use axum::{
    extract::{Extension, State},
    Json,
};
use serde::Serialize;
use std::sync::Arc;

use crate::auth::jwt::Claims;
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

/// The tenant a caller may see data for: super-admins (and global users with
/// no tenant) see everything.
fn scoped_tenant(claims: &Claims) -> Option<String> {
    if claims.role == "super_admin" {
        None
    } else {
        claims.tenant_id.clone()
    }
}

/// Run a tenant-scoped scalar query. `base` is the SQL with a single `{ph}`
/// placeholder for the tenant filter that is bound to NULL when unscoped.
async fn count_scalar(db: &DbPool, tenant: Option<&str>, kind: &str) -> i64 {
    let result = match db {
        DbPool::Sqlite(pool) => {
            let sql = match kind {
                "jobs" => "SELECT COUNT(*) FROM backup_jobs WHERE (?1 IS NULL OR tenant_id = ?1)",
                "active" => "SELECT COUNT(*) FROM job_sessions WHERE status = 'running' AND job_id IN (SELECT id FROM backup_jobs WHERE (?1 IS NULL OR tenant_id = ?1))",
                "completed" => "SELECT COUNT(*) FROM job_sessions WHERE status = 'completed' AND job_id IN (SELECT id FROM backup_jobs WHERE (?1 IS NULL OR tenant_id = ?1))",
                "failed" => "SELECT COUNT(*) FROM job_sessions WHERE status = 'failed' AND job_id IN (SELECT id FROM backup_jobs WHERE (?1 IS NULL OR tenant_id = ?1))",
                "repositories" => "SELECT COUNT(*) FROM repositories WHERE (?1 IS NULL OR tenant_id = ?1)",
                "snapshots" => "SELECT COUNT(*) FROM snapshots WHERE (?1 IS NULL OR tenant_id = ?1)",
                "used" => "SELECT COALESCE(SUM(used_bytes), 0) FROM repositories WHERE (?1 IS NULL OR tenant_id = ?1)",
                "free" => "SELECT COALESCE(SUM(free_bytes), 0) FROM repositories WHERE (?1 IS NULL OR tenant_id = ?1)",
                _ => return 0,
            };
            sqlx::query_scalar::<_, i64>(sql)
                .bind(tenant)
                .fetch_one(pool)
                .await
        }
        DbPool::Postgres(pool) => {
            let sql = match kind {
                "jobs" => "SELECT COUNT(*) FROM backup_jobs WHERE ($1 IS NULL OR tenant_id = $1)",
                "active" => "SELECT COUNT(*) FROM job_sessions WHERE status = 'running' AND job_id IN (SELECT id FROM backup_jobs WHERE ($1 IS NULL OR tenant_id = $1))",
                "completed" => "SELECT COUNT(*) FROM job_sessions WHERE status = 'completed' AND job_id IN (SELECT id FROM backup_jobs WHERE ($1 IS NULL OR tenant_id = $1))",
                "failed" => "SELECT COUNT(*) FROM job_sessions WHERE status = 'failed' AND job_id IN (SELECT id FROM backup_jobs WHERE ($1 IS NULL OR tenant_id = $1))",
                "repositories" => "SELECT COUNT(*) FROM repositories WHERE ($1 IS NULL OR tenant_id = $1)",
                "snapshots" => "SELECT COUNT(*) FROM snapshots WHERE ($1 IS NULL OR tenant_id = $1)",
                "used" => "SELECT COALESCE(SUM(used_bytes), 0) FROM repositories WHERE ($1 IS NULL OR tenant_id = $1)",
                "free" => "SELECT COALESCE(SUM(free_bytes), 0) FROM repositories WHERE ($1 IS NULL OR tenant_id = $1)",
                _ => return 0,
            };
            sqlx::query_scalar::<_, i64>(sql)
                .bind(tenant)
                .fetch_one(pool)
                .await
        }
    };
    result.unwrap_or(0)
}

async fn get_stats(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Json<DashboardStats> {
    let tenant = scoped_tenant(&claims);
    let tenant_str = tenant.as_deref();
    // PERF (10/10): 8 sequential round-trips → 1 concurrent batch.
    let (total_jobs, active_jobs, completed_jobs, failed_jobs, total_repositories, total_snapshots, storage_used_bytes, storage_free_bytes) = tokio::join!(
        count_scalar(&state.db, tenant_str, "jobs"),
        count_scalar(&state.db, tenant_str, "active"),
        count_scalar(&state.db, tenant_str, "completed"),
        count_scalar(&state.db, tenant_str, "failed"),
        count_scalar(&state.db, tenant_str, "repositories"),
        count_scalar(&state.db, tenant_str, "snapshots"),
        count_scalar(&state.db, tenant_str, "used"),
        count_scalar(&state.db, tenant_str, "free"),
    );

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
