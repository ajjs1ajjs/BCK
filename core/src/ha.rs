//! Enterprise HA active-passive (Veeam-alt minimal).
//!
//! Single-row `leader_lock` with heartbeat. The node that holds a fresh
//! lock is the leader and runs the scheduler + durable queue drain.
//! Standbys serve reads but refuse mutations at the route layer via
//! `require_leader` (writes return 409 with `X-Leader` hint).
//!
//! TTL 45s, heartbeat 15s. Split-brain window is bounded by clock skew +
//! TTL; fencing is operator-driven (STONITH) for now — documented.

use crate::db::DbPool;

const TTL_SECS: i64 = 45;

#[derive(Debug, Clone)]
pub struct Node {
    pub id: String,
}

impl Node {
    pub fn new() -> Self {
        Self {
            id: format!("{}-{}", hostname_short(), uuid::Uuid::new_v4()),
        }
    }
}

impl Default for Node {
    fn default() -> Self {
        Self::new()
    }
}

fn hostname_short() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "bck".into())
        .chars()
        .take(32)
        .collect()
}

/// Try to become/refresh leader. Returns true when this node is leader.
pub async fn heartbeat(db: &DbPool, node: &Node) -> bool {
    let now = chrono::Utc::now().timestamp();
    match db {
        DbPool::Sqlite(pool) => {
            // Take over when no row, expired, or ours.
            let r = sqlx::query(
                "INSERT INTO leader_lock (id, owner, heartbeat) VALUES ('leader', ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, heartbeat=excluded.heartbeat
                 WHERE leader_lock.owner = ?1 OR leader_lock.heartbeat < ?3",
            )
            .bind(&node.id)
            .bind(now)
            .bind(now - TTL_SECS)
            .execute(pool)
            .await;
            match r {
                Ok(res) => res.rows_affected() > 0,
                Err(e) => {
                    // Old DB without migration: single-node mode = leader.
                    if e.to_string().contains("no such table") {
                        return true;
                    }
                    false
                }
            }
        }
        DbPool::Postgres(pool) => {
            let r = sqlx::query(
                "INSERT INTO leader_lock (id, owner, heartbeat) VALUES ('leader', $1, $2)
                 ON CONFLICT(id) DO UPDATE SET owner=EXCLUDED.owner, heartbeat=EXCLUDED.heartbeat
                 WHERE leader_lock.owner = $1 OR leader_lock.heartbeat < $3",
            )
            .bind(&node.id)
            .bind(now)
            .bind(now - TTL_SECS)
            .execute(pool)
            .await;
            match r {
                Ok(res) => res.rows_affected() > 0,
                Err(e) => {
                    if e.to_string().contains("does not exist") {
                        return true;
                    }
                    false
                }
            }
        }
    }
}

pub async fn is_leader(db: &DbPool, node: &Node) -> bool {
    let now = chrono::Utc::now().timestamp();
    let owner: Option<(String, i64)> = match db {
        DbPool::Sqlite(pool) => sqlx::query_as::<_, (String, i64)>(
            "SELECT owner, heartbeat FROM leader_lock WHERE id = 'leader'",
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten(),
        DbPool::Postgres(pool) => sqlx::query_as::<_, (String, i64)>(
            "SELECT owner, heartbeat FROM leader_lock WHERE id = 'leader'",
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten(),
    };
    match owner {
        Some((o, hb)) => o == node.id && now - hb < TTL_SECS,
        None => true, // no lock row yet: first node becomes leader on heartbeat
    }
}

pub async fn leader_owner(db: &DbPool) -> Option<String> {
    match db {
        DbPool::Sqlite(pool) => sqlx::query_scalar::<_, String>(
            "SELECT owner FROM leader_lock WHERE id = 'leader'",
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten(),
        DbPool::Postgres(pool) => sqlx::query_scalar::<_, String>(
            "SELECT owner FROM leader_lock WHERE id = 'leader'",
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_is_sane() {
        assert!(TTL_SECS >= 15 && TTL_SECS <= 300);
    }

    #[test]
    fn node_id_unique() {
        assert_ne!(Node::new().id, Node::new().id);
    }

    /// HA failover simulation (no second machine needed): two nodes contend
    /// on a real SQLite DB. A wins, B stands by; A goes stale (heartbeat
    /// aged out via SQL), B takes over exactly once — no double-leader.
    #[tokio::test]
    async fn sim_ha_failover() {
        let dir = std::env::temp_dir().join(format!("bck-sim-ha-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let url = format!("sqlite://{}?mode=rwc", dir.join("ha.db").to_string_lossy().replace('\\', "/"));
        let db = DbPool::connect(&url, 2).await.unwrap();
        db.migrate().await.unwrap();

        let a = Node::new();
        let b = Node::new();
        // A becomes leader.
        assert!(heartbeat(&db, &a).await, "A must win empty lock");
        assert!(is_leader(&db, &a).await);
        // B contends while A is fresh → must NOT win.
        assert!(!heartbeat(&db, &b).await, "B must stand by while A fresh");
        assert!(!is_leader(&db, &b).await);
        // A dies: age its heartbeat beyond TTL directly in SQL.
        match &db {
            DbPool::Sqlite(pool) => {
                sqlx::query("UPDATE leader_lock SET heartbeat = ?1 WHERE id = 'leader'")
                    .bind(chrono::Utc::now().timestamp() - TTL_SECS - 10)
                    .execute(pool)
                    .await
                    .unwrap();
            }
            DbPool::Postgres(_) => unreachable!("sqlite test"),
        }
        // B takes over exactly once; A is now standby.
        assert!(heartbeat(&db, &b).await, "B must take over stale lock");
        assert!(is_leader(&db, &b).await);
        assert!(!is_leader(&db, &a).await);
        assert_eq!(leader_owner(&db).await.as_deref(), Some(b.id.as_str()));
        std::fs::remove_dir_all(&dir).ok();
    }
}
