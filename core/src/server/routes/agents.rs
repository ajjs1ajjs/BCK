use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;

use crate::db::DbPool;
use crate::server::AppState;

#[derive(Serialize)]
pub struct AgentResponse {
    pub id: String,
    pub hostname: String,
    pub ip_address: Option<String>,
    pub os_type: Option<String>,
    pub os_version: Option<String>,
    pub agent_version: Option<String>,
    pub status: String,
    pub last_seen: Option<i64>,
    pub capabilities: String,
    pub created_at: i64,
}

#[derive(Deserialize)]
pub struct HeartbeatRequest {
    pub agent_id: Option<String>,
    pub hostname: String,
    #[serde(default)]
    pub ip_address: Option<String>,
    #[serde(default)]
    pub os_type: Option<String>,
    #[serde(default)]
    pub os_version: Option<String>,
    #[serde(default)]
    pub agent_version: Option<String>,
    #[serde(default)]
    pub capabilities: Option<Vec<String>>,
    #[serde(default)]
    pub cpu_usage: Option<f64>,
    #[serde(default)]
    pub memory_usage: Option<f64>,
    #[serde(default)]
    pub disk_free_bytes: Option<u64>,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_agents))
        .route("/:id", axum::routing::get(get_agent).delete(delete_agent))
        .route("/:id/tasks", axum::routing::post(create_agent_task))
        .route("/:id/tasks", axum::routing::get(list_agent_tasks))
}

#[derive(Deserialize)]
pub struct CreateAgentTaskRequest {
    pub task_type: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Serialize)]
pub struct AgentTaskResponse {
    pub id: String,
    pub agent_id: String,
    pub task_type: String,
    pub status: String,
    pub payload: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

pub async fn create_agent_task(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<CreateAgentTaskRequest>,
) -> Result<Json<AgentTaskResponse>, StatusCode> {
    let task_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let payload = req.payload.to_string();

    let result: Result<(), String> = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO agent_tasks (id, agent_id, task_type, status, payload, created_at)
                 VALUES (?1, ?2, ?3, 'pending', ?4, ?5)"
            )
            .bind(&task_id)
            .bind(&id)
            .bind(&req.task_type)
            .bind(&payload)
            .bind(now)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO agent_tasks (id, agent_id, task_type, status, payload, created_at)
                 VALUES ($1, $2, $3, 'pending', $4, $5)"
            )
            .bind(&task_id)
            .bind(&id)
            .bind(&req.task_type)
            .bind(&payload)
            .bind(now)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
    };

    match result {
        Ok(()) => {
            crate::db::record_event(
                &state.db,
                "agent_task_created",
                "agents",
                &format!("Agent task {task_id} ({}) created for {id}", req.task_type),
                None,
                None,
            ).await.ok();
            Ok(Json(AgentTaskResponse {
                id: task_id.clone(),
                agent_id: id.clone(),
                task_type: req.task_type.clone(),
                status: "pending".into(),
                payload: req.payload,
                result: None,
                created_at: now,
                completed_at: None,
            }))
        }
        Err(e) => {
            tracing::error!("create agent task: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Deserialize)]
pub struct TaskReportRequest {
    pub status: String,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
}

/// Agent polls for pending tasks assigned to it.
pub async fn poll_pending_tasks(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AgentTaskResponse>>, StatusCode> {
    let tasks = match &state.db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query(
                "SELECT id, agent_id, task_type, status, payload, result, created_at, completed_at
                 FROM agent_tasks WHERE agent_id = ?1 AND status = 'pending'
                 ORDER BY created_at ASC"
            )
            .bind(&id)
            .fetch_all(pool)
            .await
            .map_err(|e| {
                tracing::error!("poll agent tasks: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            rows.into_iter().map(|r| {
                let payload: serde_json::Value = serde_json::from_str(
                    r.get::<String, _>("payload").as_str()
                ).unwrap_or_else(|_| serde_json::json!({}));
                let result: Option<serde_json::Value> = r.get::<Option<String>, _>("result")
                    .and_then(|s| serde_json::from_str(&s).ok());
                AgentTaskResponse {
                    id: r.get("id"),
                    agent_id: r.get("agent_id"),
                    task_type: r.get("task_type"),
                    status: r.get("status"),
                    payload,
                    result,
                    created_at: r.get("created_at"),
                    completed_at: r.get("completed_at"),
                }
            }).collect()
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT id, agent_id, task_type, status, payload, result, created_at, completed_at
                 FROM agent_tasks WHERE agent_id = $1 AND status = 'pending'
                 ORDER BY created_at ASC"
            )
            .bind(&id)
            .fetch_all(pool)
            .await
            .map_err(|e| {
                tracing::error!("poll agent tasks: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            rows.into_iter().map(|r| {
                let payload: serde_json::Value = serde_json::from_str(
                    r.get::<String, _>("payload").as_str()
                ).unwrap_or_else(|_| serde_json::json!({}));
                let result: Option<serde_json::Value> = r.get::<Option<String>, _>("result")
                    .and_then(|s| serde_json::from_str(&s).ok());
                AgentTaskResponse {
                    id: r.get("id"),
                    agent_id: r.get("agent_id"),
                    task_type: r.get("task_type"),
                    status: r.get("status"),
                    payload,
                    result,
                    created_at: r.get("created_at"),
                    completed_at: r.get("completed_at"),
                }
            }).collect()
        }
    };
    Ok(Json(tasks))
}

/// Agent reports the outcome of a task it picked up.
pub async fn report_task_status(
    State(state): State<Arc<AppState>>,
    Path((id, task_id)): Path<(String, String)>,
    Json(req): Json<TaskReportRequest>,
) -> StatusCode {
    let now = chrono::Utc::now().timestamp();
    let result = req.result.map(|r| r.to_string());
    let (status, completed_at) = match req.status.as_str() {
        "completed" | "success" => ("completed".to_string(), Some(now)),
        "failed" | "error" => ("failed".to_string(), Some(now)),
        _ => ("running".to_string(), None),
    };

    let r: Result<(), String> = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "UPDATE agent_tasks SET status = ?1, result = ?2, completed_at = ?3
                 WHERE id = ?4 AND agent_id = ?5"
            )
            .bind(&status)
            .bind(&result)
            .bind(completed_at)
            .bind(&task_id)
            .bind(&id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "UPDATE agent_tasks SET status = $1, result = $2, completed_at = $3
                 WHERE id = $4 AND agent_id = $5"
            )
            .bind(&status)
            .bind(&result)
            .bind(completed_at)
            .bind(&task_id)
            .bind(&id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
    };

    match r {
        Ok(()) => {
            crate::db::record_event(
                &state.db,
                "agent_task_report",
                "agents",
                &format!("Agent task {task_id} reported {status}"),
                None,
                None,
            ).await.ok();
            StatusCode::OK
        }
        Err(e) => {
            tracing::error!("report agent task: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

async fn list_agent_tasks(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AgentTaskResponse>>, StatusCode> {
    let tasks = fetch_agent_tasks(&state.db, &id).await
        .map_err(|e| {
            tracing::error!("list agent tasks: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(tasks))
}

async fn fetch_agent_tasks(db: &DbPool, agent_id: &str) -> anyhow::Result<Vec<AgentTaskResponse>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query(
                "SELECT id, agent_id, task_type, status, payload, result, created_at, completed_at
                 FROM agent_tasks WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT 100"
            )
            .bind(agent_id)
            .fetch_all(pool)
            .await?;
            rows.into_iter().map(|r| {
                let payload: serde_json::Value = serde_json::from_str(
                    r.get::<String, _>("payload").as_str()
                ).unwrap_or_else(|_| serde_json::json!({}));
                let result: Option<serde_json::Value> = r.get::<Option<String>, _>("result")
                    .and_then(|s| serde_json::from_str(&s).ok());
                Ok(AgentTaskResponse {
                    id: r.get("id"),
                    agent_id: r.get("agent_id"),
                    task_type: r.get("task_type"),
                    status: r.get("status"),
                    payload,
                    result,
                    created_at: r.get("created_at"),
                    completed_at: r.get("completed_at"),
                })
            }).collect()
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT id, agent_id, task_type, status, payload, result, created_at, completed_at
                 FROM agent_tasks WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 100"
            )
            .bind(agent_id)
            .fetch_all(pool)
            .await?;
            rows.into_iter().map(|r| {
                let payload: serde_json::Value = serde_json::from_str(
                    r.get::<String, _>("payload").as_str()
                ).unwrap_or_else(|_| serde_json::json!({}));
                let result: Option<serde_json::Value> = r.get::<Option<String>, _>("result")
                    .and_then(|s| serde_json::from_str(&s).ok());
                Ok(AgentTaskResponse {
                    id: r.get("id"),
                    agent_id: r.get("agent_id"),
                    task_type: r.get("task_type"),
                    status: r.get("status"),
                    payload,
                    result,
                    created_at: r.get("created_at"),
                    completed_at: r.get("completed_at"),
                })
            }).collect()
        }
    }
}


pub async fn heartbeat(
    State(state): State<Arc<AppState>>,
    Json(req): Json<HeartbeatRequest>,
) -> StatusCode {
    let id = req.agent_id.clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = chrono::Utc::now().timestamp();
    let capabilities = req.capabilities.clone()
        .map(|caps| serde_json::to_string(&caps).unwrap_or_else(|_| "[]".into()))
        .unwrap_or_else(|| "[]".into());

    let result: Result<(), String> = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO agents (id, hostname, ip_address, os_type, os_version, agent_version, status, last_seen, capabilities, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'online', ?7, ?8, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    hostname = excluded.hostname,
                    ip_address = excluded.ip_address,
                    os_type = excluded.os_type,
                    os_version = excluded.os_version,
                    agent_version = excluded.agent_version,
                    status = 'online',
                    last_seen = excluded.last_seen,
                    capabilities = excluded.capabilities"
            )
            .bind(&id)
            .bind(&req.hostname)
            .bind(&req.ip_address)
            .bind(&req.os_type)
            .bind(&req.os_version)
            .bind(&req.agent_version)
            .bind(now)
            .bind(&capabilities)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO agents (id, hostname, ip_address, os_type, os_version, agent_version, status, last_seen, capabilities, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'online', $7, $8, $7)
                 ON CONFLICT(id) DO UPDATE SET
                    hostname = EXCLUDED.hostname,
                    ip_address = EXCLUDED.ip_address,
                    os_type = EXCLUDED.os_type,
                    os_version = EXCLUDED.os_version,
                    agent_version = EXCLUDED.agent_version,
                    status = 'online',
                    last_seen = EXCLUDED.last_seen,
                    capabilities = EXCLUDED.capabilities"
            )
            .bind(&id)
            .bind(&req.hostname)
            .bind(&req.ip_address)
            .bind(&req.os_type)
            .bind(&req.os_version)
            .bind(&req.agent_version)
            .bind(now)
            .bind(&capabilities)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
    };

    match result {
        Ok(()) => StatusCode::OK,
        Err(e) => {
            tracing::error!("agent heartbeat: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

async fn list_agents(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<AgentResponse>>, StatusCode> {
    let agents = fetch_agents(&state.db).await
        .map_err(|e| {
            tracing::error!("list agents: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(agents))
}

async fn get_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<AgentResponse>, StatusCode> {
    let agent = fetch_agents(&state.db).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(agent))
}

async fn delete_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let affected = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query("DELETE FROM agents WHERE id = ?1")
                .bind(&id)
                .execute(pool)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .rows_affected()
        }
        DbPool::Postgres(pool) => {
            sqlx::query("DELETE FROM agents WHERE id = $1")
                .bind(&id)
                .execute(pool)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .rows_affected()
        }
    };
    if affected == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn fetch_agents(db: &DbPool) -> anyhow::Result<Vec<AgentResponse>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query_as::<_, crate::db::models::agent::AgentModel>(
                "SELECT id, hostname, ip_address, os_type, os_version, agent_version, status,
                        last_seen, capabilities, created_at
                 FROM agents ORDER BY last_seen DESC"
            )
            .fetch_all(pool)
            .await?;
            Ok(rows.into_iter().map(|r| AgentResponse {
                id: r.id,
                hostname: r.hostname,
                ip_address: r.ip_address,
                os_type: r.os_type,
                os_version: r.os_version,
                agent_version: r.agent_version,
                status: r.status,
                last_seen: r.last_seen,
                capabilities: r.capabilities,
                created_at: r.created_at,
            }).collect())
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query_as::<_, crate::db::models::agent::AgentModel>(
                "SELECT id, hostname, ip_address, os_type, os_version, agent_version, status,
                        last_seen, capabilities, created_at
                 FROM agents ORDER BY last_seen DESC"
            )
            .fetch_all(pool)
            .await?;
            Ok(rows.into_iter().map(|r| AgentResponse {
                id: r.id,
                hostname: r.hostname,
                ip_address: r.ip_address,
                os_type: r.os_type,
                os_version: r.os_version,
                agent_version: r.agent_version,
                status: r.status,
                last_seen: r.last_seen,
                capabilities: r.capabilities,
                created_at: r.created_at,
            }).collect())
        }
    }
}
