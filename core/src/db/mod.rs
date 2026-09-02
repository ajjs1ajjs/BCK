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
