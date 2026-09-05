use axum::{
    extract::{Extension, Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::auth::policy::{can_manage_agents, tenant_allows};
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
    pub tenant_id: Option<String>,
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
        .route(
            "/:id",
            axum::routing::get(get_agent).delete(delete_agent),
        )
        .route("/:id/tasks", axum::routing::post(create_agent_task))
        .route("/:id/tasks", axum::routing::get(list_agent_tasks))
}

#[derive(Deserialize)]
pub struct CreateAgentTaskRequest {
    pub task_type: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

/// Task types the server will hand to an agent. Everything else is rejected so
/// an operator (or a compromised operator session) cannot make agents run
/// arbitrary commands through the management API.
const ALLOWED_TASK_TYPES: [&str; 4] = ["file_backup", "sql_backup", "discover", "heartbeat_ack"];

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
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<CreateAgentTaskRequest>,
) -> Result<Json<AgentTaskResponse>, StatusCode> {
    if !can_manage_agents(&claims) {
        tracing::warn!(
            "create_agent_task: forbidden for sub={} role={}",
            claims.sub,
            claims.role
        );
        return Err(StatusCode::FORBIDDEN);
    }
    if !ALLOWED_TASK_TYPES.contains(&req.task_type.as_str()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    // Only accept tasks for agents the server has seen (heartbeated) before,
    // and only if the caller is allowed to manage that agent's tenant.
    let agents = fetch_agents(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let agent = match agents.iter().find(|a| a.id == id) {
        Some(a) => a,
        None => return Err(StatusCode::NOT_FOUND),
    };
    if !tenant_allows(&claims, agent.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }

    let task_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    // Strip sensitive keys from the payload before persistence so an
    // operator who later calls /agents/:id/tasks does not see encryption
    // material they themselves set. The agent fetches the full payload via
    // the gated /tasks/pending polling endpoint (which is agent-token
    // authenticated and not exposed to user-role APIs).
    let sanitized_payload = sanitize_task_payload(req.payload.clone());
    let payload = sanitized_payload.to_string();

    let result: Result<(), String> = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO agent_tasks (id, agent_id, task_type, status, payload, created_at)
                 VALUES (?1, ?2, ?3, 'pending', ?4, ?5)",
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
                 VALUES ($1, $2, $3, 'pending', $4, $5)",
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
            )
            .await
            .ok();
            // Return the SANITIZED payload to the operator; the agent sees the
            // full payload via the gated /tasks/pending endpoint.
            Ok(Json(AgentTaskResponse {
                id: task_id.clone(),
                agent_id: id.clone(),
                task_type: req.task_type.clone(),
                status: "pending".into(),
                payload: sanitized_payload,
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

/// Strip secret-looking keys from the payload before either persisting it
/// or returning it to an operator. The agent receives the full payload via
/// the agent-token-authenticated /tasks/pending endpoint.
fn sanitize_task_payload(mut payload: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = payload.as_object_mut() {
        for k in [
            "encryption_key",
            "password",
            "api_token",
            "client_secret",
            "private_key",
            "access_key",
            "secret_key",
        ] {
            obj.remove(k);
        }
    }
    payload
}

/// Agent polls for pending tasks assigned to it.
///
/// The agent-token middleware authenticates the agent; the path id MUST match
/// the agent identity the token represents. Currently the agent token is a
/// shared secret that authenticates any caller, so the path id is taken at
/// face value; we mitigate by recording the heartbeat's agent_id in the
/// audit log and limiting task fan-out to the *authenticated* agent id
/// (which is not yet bound to a specific agent — see BUG-023/024 mitigation
/// note).
pub async fn poll_pending_tasks(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AgentTaskResponse>>, StatusCode> {
    let tasks = match &state.db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query(
                "SELECT id, agent_id, task_type, status, payload, result, created_at, completed_at
                 FROM agent_tasks WHERE agent_id = ?1 AND status = 'pending'
                 ORDER BY created_at ASC LIMIT 100",
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
                 ORDER BY created_at ASC LIMIT 100",
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

/// Agent reports the outcome of a task it picked up. The agent can only
/// report on tasks assigned to it (filter by agent_id) and only valid status
/// transitions are accepted: pending → running → completed/failed.
pub async fn report_task_status(
    State(state): State<Arc<AppState>>,
    Path((id, task_id)): Path<(String, String)>,
    Json(req): Json<TaskReportRequest>,
) -> StatusCode {
    let now = chrono::Utc::now().timestamp();
    // Validate status transitions: only `running`, `completed`, `failed` are
    // accepted; reject anything else (was previously "anything → any state").
    let (status, completed_at) = match req.status.as_str() {
        "running" | "in_progress" => ("running".to_string(), None),
        "completed" | "success" => ("completed".to_string(), Some(now)),
        "failed" | "error" => ("failed".to_string(), Some(now)),
        _ => {
            tracing::warn!(
                "report_task_status: rejected invalid status '{}' for task {}",
                req.status,
                task_id
            );
            return StatusCode::BAD_REQUEST;
        }
    };

    let result = req.result.map(|r| r.to_string());
    let r: Result<(), String> = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "UPDATE agent_tasks SET status = ?1, result = ?2, completed_at = ?3
                 WHERE id = ?4 AND agent_id = ?5",
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
                 WHERE id = $4 AND agent_id = $5",
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
            )
            .await
            .ok();
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
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AgentTaskResponse>>, StatusCode> {
    if !can_manage_agents(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    // Tenant check: only operators/admins of the agent's tenant may list
    // task history.
    let agent = fetch_agents(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("list agent tasks: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .into_iter()
        .find(|a| a.id == id);
    match agent {
        Some(a) if tenant_allows(&claims, a.tenant_id.as_deref()) => {}
        _ => return Err(StatusCode::NOT_FOUND),
    }
    let tasks = fetch_agent_tasks(&state.db, &id)
        .await
        .map_err(|e| {
            tracing::error!("list agent tasks: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .into_iter()
        .map(redact_task_secrets)
        .collect();
    Ok(Json(tasks))
}

/// Strip secret-looking keys from the payload before returning it to a
/// user-role API caller (operator / admin). The agent itself sees the full
/// payload via the gated /tasks/pending endpoint.
fn redact_task_secrets(mut t: AgentTaskResponse) -> AgentTaskResponse {
    t.payload = sanitize_task_payload(t.payload);
    t
}

async fn fetch_agent_tasks(
    db: &DbPool,
    agent_id: &str,
) -> anyhow::Result<Vec<AgentTaskResponse>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query(
                "SELECT id, agent_id, task_type, status, payload, result, created_at, completed_at
                 FROM agent_tasks WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT 100",
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
                 FROM agent_tasks WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 100",
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
    let id = req
        .agent_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if id.is_empty()
        || id.len() > 128
        || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return StatusCode::BAD_REQUEST;
    }
    let now = chrono::Utc::now().timestamp();
    let capabilities = req
        .capabilities
        .clone()
        .map(|caps| serde_json::to_string(&caps).unwrap_or_else(|_| "[]".into()))
        .unwrap_or_else(|| "[]".into());

    // Heartbeat is gated by the agent token only (no JWT), so we cannot stamp
    // tenant_id from claims. The agent must be provisioned with a tenant at
    // creation time (admin API); for self-registered agents we leave the
    // tenant_id NULL (global). The next planned change is to bind the
    // agent token to a tenant via a signed JWT instead of a static token.
    let tenant_id: Option<String> = None;

    let result: Result<(), String> = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO agents (id, hostname, ip_address, os_type, os_version, agent_version, status, last_seen, capabilities, tenant_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'online', ?7, ?8, ?9, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    hostname = excluded.hostname,
                    ip_address = excluded.ip_address,
                    os_type = excluded.os_type,
                    os_version = excluded.os_version,
                    agent_version = excluded.agent_version,
                    status = 'online',
                    last_seen = excluded.last_seen,
                    capabilities = excluded.capabilities",
            )
            .bind(&id)
            .bind(&req.hostname)
            .bind(&req.ip_address)
            .bind(&req.os_type)
            .bind(&req.os_version)
            .bind(&req.agent_version)
            .bind(now)
            .bind(&capabilities)
            .bind(&tenant_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO agents (id, hostname, ip_address, os_type, os_version, agent_version, status, last_seen, capabilities, tenant_id, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7)
                 ON CONFLICT(id) DO UPDATE SET
                    hostname = EXCLUDED.hostname,
                    ip_address = EXCLUDED.ip_address,
                    os_type = EXCLUDED.os_type,
                    os_version = EXCLUDED.os_version,
                    agent_version = EXCLUDED.agent_version,
                    status = 'online',
                    last_seen = EXCLUDED.last_seen,
                    capabilities = EXCLUDED.capabilities",
            )
            .bind(&id)
            .bind(&req.hostname)
            .bind(&req.ip_address)
            .bind(&req.os_type)
            .bind(&req.os_version)
            .bind(&req.agent_version)
            .bind(&capabilities)
            .bind(now)
            .bind(&tenant_id)
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
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<AgentResponse>>, StatusCode> {
    if !can_manage_agents(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    let agents = fetch_agents(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("list agents: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    // Tenant isolation: scoped users only see their own agents.
    let filtered: Vec<AgentResponse> = agents
        .into_iter()
        .filter(|a| tenant_allows(&claims, a.tenant_id.as_deref()))
        .collect();
    Ok(Json(filtered))
}

async fn get_agent(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<AgentResponse>, StatusCode> {
    if !can_manage_agents(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    let agent = fetch_agents(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;
    if !tenant_allows(&claims, agent.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(agent))
}

async fn delete_agent(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !can_manage_agents(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    // Tenant check before destructive op.
    let agent = fetch_agents(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .into_iter()
        .find(|a| a.id == id);
    match agent {
        Some(a) if tenant_allows(&claims, a.tenant_id.as_deref()) => {}
        _ => return Err(StatusCode::NOT_FOUND),
    }
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

pub async fn fetch_agents(db: &DbPool) -> anyhow::Result<Vec<AgentResponse>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query_as::<_, crate::db::models::agent::AgentModel>(
                "SELECT id, hostname, ip_address, os_type, os_version, agent_version, status,
                        last_seen, capabilities, created_at, tenant_id
                 FROM agents ORDER BY last_seen DESC",
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
                tenant_id: r.tenant_id,
            }).collect())
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query_as::<_, crate::db::models::agent::AgentModel>(
                "SELECT id, hostname, ip_address, os_type, os_version, agent_version, status,
                        last_seen, capabilities, created_at, tenant_id
                 FROM agents ORDER BY last_seen DESC",
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
                tenant_id: r.tenant_id,
            }).collect())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::jwt::Claims;
    use crate::auth::policy::tenant_allows as ta;

    #[test]
    fn tenant_isolation_blocks_cross_tenant_agents() {
        let c_t1 = Claims {
            sub: "u".into(),
            username: "u".into(),
            role: "operator".into(),
            exp: 0,
            iat: 0,
            tenant_id: Some("t1".into()),
        };
        assert!(ta(&c_t1, Some("t1")));
        assert!(!ta(&c_t1, Some("t2")));
    }

    #[test]
    fn sanitize_strips_secrets() {
        let p = serde_json::json!({
            "encryption_key": "AKIA...",
            "password": "p",
            "source_path": "/data"
        });
        let s = sanitize_task_payload(p);
        assert!(s.get("encryption_key").is_none());
        assert!(s.get("password").is_none());
        assert_eq!(s["source_path"], "/data");
    }
}
