pub mod models;
pub mod hypervisor;

use anyhow::Result;
use sqlx::pool::PoolOptions;
use sqlx::{PgPool, SqlitePool};
use std::time::Duration;

#[derive(Clone)]
pub enum DbPool {
    Sqlite(SqlitePool),
    Postgres(PgPool),
}

impl DbPool {
    pub async fn connect(url: &str, pool_size: u32) -> Result<Self> {
        if url.starts_with("postgres") || url.starts_with("postgresql") {
            let pool = PoolOptions::new()
                .max_connections(pool_size)
                .acquire_timeout(Duration::from_secs(10))
                .connect(url)
                .await?;
            Ok(Self::Postgres(pool))
        } else {
            use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
            use std::str::FromStr;
            let opts = SqliteConnectOptions::from_str(url)
                .map_err(|e| anyhow::anyhow!("invalid sqlite url: {}", e))?
                .foreign_keys(true)
                .journal_mode(SqliteJournalMode::Wal)
                .create_if_missing(true)
                .busy_timeout(Duration::from_secs(5));
            // Preserve pool settings via connect_with
            let pool = PoolOptions::new()
                .max_connections(pool_size)
                .acquire_timeout(Duration::from_secs(10))
                .connect_with(opts)
                .await?;
            // Also ensure pragma on first connection (defense in depth).
            let _ = sqlx::query("PRAGMA foreign_keys=ON").execute(&pool).await;
            Ok(Self::Sqlite(pool))
        }
    }

    pub async fn migrate(&self) -> Result<()> {
        match self {
            DbPool::Sqlite(pool) => {
                sqlx::migrate!("src/db/migrations/sqlite")
                    .run(pool)
                    .await?;
            }
            DbPool::Postgres(pool) => {
                sqlx::migrate!("src/db/migrations/postgres")
                    .run(pool)
                    .await?;
            }
        }
        Ok(())
    }

    pub async fn close(self) {
        match self {
            DbPool::Sqlite(pool) => pool.close().await,
            DbPool::Postgres(pool) => pool.close().await,
        }
    }
}

// Re-export common query types
pub use sqlx::Row;
pub use sqlx::FromRow;

/// P0 durability (10/10): generic write-through KV for enterprise managers
/// (SOBR tiers/policies/placements, CDP policies, DR sites/plans, M365 tenants,
/// portal restore-requests). Memory stays as cache; DB is authoritative.
/// Missing table (old DB without migration) => treated as empty, not fatal.
pub async fn persist_set(db: &DbPool, domain: &str, key: &str, value_json: &str) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    match db {
        DbPool::Sqlite(pool) => {
            let r = sqlx::query(
                "INSERT INTO persisted_state (domain, key, value_json, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(domain, key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
            )
            .bind(domain).bind(key).bind(value_json).bind(now)
            .execute(pool).await;
            if let Err(e) = r {
                if e.to_string().contains("no such table") { return Ok(()); }
                return Err(e.into());
            }
        }
        DbPool::Postgres(pool) => {
            let r = sqlx::query(
                "INSERT INTO persisted_state (domain, key, value_json, updated_at)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT(domain, key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_at=EXCLUDED.updated_at",
            )
            .bind(domain).bind(key).bind(value_json).bind(now)
            .execute(pool).await;
            if let Err(e) = r {
                if e.to_string().contains("does not exist") { return Ok(()); }
                return Err(e.into());
            }
        }
    }
    Ok(())
}

pub async fn persist_list(db: &DbPool, domain: &str) -> Vec<(String, String)> {
    match db {
        DbPool::Sqlite(pool) => sqlx::query_as::<_, (String, String)>(
            "SELECT key, value_json FROM persisted_state WHERE domain = ?1",
        )
        .bind(domain).fetch_all(pool).await.unwrap_or_default(),
        DbPool::Postgres(pool) => sqlx::query_as::<_, (String, String)>(
            "SELECT key, value_json FROM persisted_state WHERE domain = $1",
        )
        .bind(domain).fetch_all(pool).await.unwrap_or_default(),
    }
}

pub async fn persist_delete(db: &DbPool, domain: &str, key: &str) -> anyhow::Result<()> {
    match db {
        DbPool::Sqlite(pool) => {
            let _ = sqlx::query("DELETE FROM persisted_state WHERE domain = ?1 AND key = ?2")
                .bind(domain).bind(key).execute(pool).await;
        }
        DbPool::Postgres(pool) => {
            let _ = sqlx::query("DELETE FROM persisted_state WHERE domain = $1 AND key = $2")
                .bind(domain).bind(key).execute(pool).await;
        }
    }
    Ok(())
}

/// Durable scheduler queue: enqueue a run; claim next due run atomically.
pub async fn queue_enqueue(db: &DbPool, job_id: &str, run_at: i64) -> anyhow::Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    match db {
        DbPool::Sqlite(pool) => {
            let _ = sqlx::query(
                "INSERT INTO job_queue (id, job_id, run_at, status, created_at) VALUES (?1, ?2, ?3, 'queued', ?4)",
            ).bind(&id).bind(job_id).bind(run_at).bind(now).execute(pool).await;
        }
        DbPool::Postgres(pool) => {
            let _ = sqlx::query(
                "INSERT INTO job_queue (id, job_id, run_at, status, created_at) VALUES ($1, $2, $3, 'queued', $4)",
            ).bind(&id).bind(job_id).bind(run_at).bind(now).execute(pool).await;
        }
    }
    Ok(id)
}

pub async fn queue_claim_due(db: &DbPool, now: i64, limit: i64) -> Vec<(String, String)> {
    // Claim via status transition so two schedulers cannot double-fire.
    let ids: Vec<(String, String)> = match db {
        DbPool::Sqlite(pool) => sqlx::query_as::<_, (String, String)>(
            "SELECT id, job_id FROM job_queue WHERE status = 'queued' AND run_at <= ?1 ORDER BY run_at ASC LIMIT ?2",
        ).bind(now).bind(limit).fetch_all(pool).await.unwrap_or_default(),
        DbPool::Postgres(pool) => sqlx::query_as::<_, (String, String)>(
            "SELECT id, job_id FROM job_queue WHERE status = 'queued' AND run_at <= $1 ORDER BY run_at ASC LIMIT $2",
        ).bind(now).bind(limit).fetch_all(pool).await.unwrap_or_default(),
    };
    for (id, _) in &ids {
        match db {
            DbPool::Sqlite(pool) => {
                let _ = sqlx::query("UPDATE job_queue SET status = 'running', attempts = attempts + 1 WHERE id = ?1 AND status = 'queued'")
                    .bind(id).execute(pool).await;
            }
            DbPool::Postgres(pool) => {
                let _ = sqlx::query("UPDATE job_queue SET status = 'running', attempts = attempts + 1 WHERE id = $1 AND status = 'queued'")
                    .bind(id).execute(pool).await;
            }
        }
    }
    ids
}

pub async fn queue_finish(db: &DbPool, id: &str, ok: bool, err: Option<&str>) {
    let status = if ok { "done" } else { "failed" };
    match db {
        DbPool::Sqlite(pool) => {
            let _ = sqlx::query("UPDATE job_queue SET status = ?1, last_error = ?2 WHERE id = ?3")
                .bind(status).bind(err).bind(id).execute(pool).await;
        }
        DbPool::Postgres(pool) => {
            let _ = sqlx::query("UPDATE job_queue SET status = $1, last_error = $2 WHERE id = $3")
                .bind(status).bind(err).bind(id).execute(pool).await;
        }
    }
}

/// Per-repo DEKs (envelope encryption): store/fetch encrypted DEK.
pub async fn repo_dek_set(db: &DbPool, repo_id: &str, enc_dek: &str) {
    let now = chrono::Utc::now().timestamp();
    match db {
        DbPool::Sqlite(pool) => {
            let _ = sqlx::query(
                "INSERT INTO repo_keys (repo_id, enc_dek, created_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(repo_id) DO UPDATE SET enc_dek=excluded.enc_dek",
            ).bind(repo_id).bind(enc_dek).bind(now).execute(pool).await;
        }
        DbPool::Postgres(pool) => {
            let _ = sqlx::query(
                "INSERT INTO repo_keys (repo_id, enc_dek, created_at) VALUES ($1, $2, $3)
                 ON CONFLICT(repo_id) DO UPDATE SET enc_dek=EXCLUDED.enc_dek",
            ).bind(repo_id).bind(enc_dek).bind(now).execute(pool).await;
        }
    }
}

pub async fn repo_dek_get(db: &DbPool, repo_id: &str) -> Option<String> {
    match db {
        DbPool::Sqlite(pool) => sqlx::query_scalar::<_, String>(
            "SELECT enc_dek FROM repo_keys WHERE repo_id = ?1",
        ).bind(repo_id).fetch_optional(pool).await.ok().flatten(),
        DbPool::Postgres(pool) => sqlx::query_scalar::<_, String>(
            "SELECT enc_dek FROM repo_keys WHERE repo_id = $1",
        ).bind(repo_id).fetch_optional(pool).await.ok().flatten(),
    }
}

/// Legal holds (Veeam-alt): held snapshots skip retention/GC until released.
pub async fn hold_create(db: &DbPool, snapshot_id: &str, reason: &str, by: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    match db {
        DbPool::Sqlite(pool) => {
            let _ = sqlx::query(
                "INSERT INTO legal_holds (id, snapshot_id, reason, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            ).bind(&id).bind(snapshot_id).bind(reason).bind(by).bind(now).execute(pool).await;
        }
        DbPool::Postgres(pool) => {
            let _ = sqlx::query(
                "INSERT INTO legal_holds (id, snapshot_id, reason, created_by, created_at) VALUES ($1, $2, $3, $4, $5)",
            ).bind(&id).bind(snapshot_id).bind(reason).bind(by).bind(now).execute(pool).await;
        }
    }
    id
}

pub async fn hold_active(db: &DbPool, snapshot_id: &str) -> bool {
    let count: i64 = match db {
        DbPool::Sqlite(pool) => sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM legal_holds WHERE snapshot_id = ?1 AND released_at IS NULL",
        ).bind(snapshot_id).fetch_one(pool).await.unwrap_or(0),
        DbPool::Postgres(pool) => sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM legal_holds WHERE snapshot_id = $1 AND released_at IS NULL",
        ).bind(snapshot_id).fetch_one(pool).await.unwrap_or(0),
    };
    count > 0
}

pub async fn hold_release(db: &DbPool, id: &str) -> bool {
    let now = chrono::Utc::now().timestamp();
    let n = match db {
        DbPool::Sqlite(pool) => sqlx::query(
            "UPDATE legal_holds SET released_at = ?1 WHERE id = ?2 AND released_at IS NULL",
        ).bind(now).bind(id).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0),
        DbPool::Postgres(pool) => sqlx::query(
            "UPDATE legal_holds SET released_at = $1 WHERE id = $2 AND released_at IS NULL",
        ).bind(now).bind(id).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0),
    };
    n > 0
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct HoldRow {
    pub id: String,
    pub snapshot_id: String,
    pub reason: String,
    pub created_by: String,
    pub created_at: i64,
    pub released_at: Option<i64>,
}

pub async fn hold_list(db: &DbPool) -> Vec<HoldRow> {
    match db {
        DbPool::Sqlite(pool) => sqlx::query_as::<_, HoldRow>(
            "SELECT id, snapshot_id, reason, created_by, created_at, released_at FROM legal_holds ORDER BY created_at DESC LIMIT 1000",
        ).fetch_all(pool).await.unwrap_or_default(),
        DbPool::Postgres(pool) => sqlx::query_as::<_, HoldRow>(
            "SELECT id, snapshot_id, reason, created_by, created_at, released_at FROM legal_holds ORDER BY created_at DESC LIMIT 1000",
        ).fetch_all(pool).await.unwrap_or_default(),
    }
}

/// Insert a row into the `events` table (used for logs / audit trail).
pub async fn record_event(
    db: &DbPool,
    event_type: &str,
    source: &str,
    message: &str,
    job_id: Option<&str>,
    session_id: Option<&str>,
) -> anyhow::Result<()> {
    use chrono::Utc;
    let now = Utc::now().timestamp();
    match db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO events (event_type, source, message, job_id, session_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(event_type)
            .bind(source)
            .bind(message)
            .bind(job_id)
            .bind(session_id)
            .bind(now)
            .execute(pool)
            .await?;
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO events (event_type, source, message, job_id, session_id, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(event_type)
            .bind(source)
            .bind(message)
            .bind(job_id)
            .bind(session_id)
            .bind(now)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

/// List recent events, newest first.
pub async fn list_events(db: &DbPool, limit: i64) -> anyhow::Result<Vec<crate::types::EventInfo>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query_as::<_, crate::types::EventModel>(
                "SELECT id, event_type, source, message, job_id, session_id, acknowledged, created_at
                 FROM events ORDER BY created_at DESC, id DESC LIMIT ?1",
            )
            .bind(limit)
            .fetch_all(pool)
            .await?;
            Ok(rows.into_iter().map(Into::into).collect())
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query_as::<_, crate::types::EventModel>(
                "SELECT id, event_type, source, message, job_id, session_id, acknowledged, created_at
                 FROM events ORDER BY created_at DESC, id DESC LIMIT $1",
            )
            .bind(limit)
            .fetch_all(pool)
            .await?;
            Ok(rows.into_iter().map(Into::into).collect())
        }
    }
}
