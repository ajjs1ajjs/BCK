pub mod models;

use anyhow::Result;
use sqlx::pool::PoolOptions;
use sqlx::{PgPool, SqlitePool};
use std::time::Duration;

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
            let pool = PoolOptions::new()
                .max_connections(pool_size)
                .acquire_timeout(Duration::from_secs(10))
                .connect(url)
                .await?;
            Ok(Self::Sqlite(pool))
        }
    }

    pub async fn migrate(&self) -> Result<()> {
        match self {
            DbPool::Sqlite(pool) => {
                sqlx::migrate!("src/db/migrations")
                    .run(pool)
                    .await?;
            }
            DbPool::Postgres(pool) => {
                sqlx::migrate!("src/db/migrations")
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
