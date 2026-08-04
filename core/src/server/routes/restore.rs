use axum::{
    extract::{Path, State, Query},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use crate::db::models::snapshot::SnapshotModel;
use crate::db::models::repository::RepositoryModel;
use crate::db::DbPool;
use crate::restore::{RestoreSession, RestoreStatus, RestoreType};
use crate::server::AppState;

#[derive(Deserialize)]
pub struct VmRestoreRequest {
    pub snapshot_id: String,
    pub target_datastore: String,
    pub target_host: Option<String>,
    pub vm_name: Option<String>,
    pub power_on: bool,
}

#[derive(Deserialize)]
pub struct FileRestoreRequest {
    pub snapshot_id: String,
    pub files: Vec<String>,
    pub target_path: String,
    pub overwrite: Option<bool>,
}

#[derive(Deserialize)]
pub struct InstantRecoveryRequest {
    pub snapshot_id: String,
    pub vm_name: String,
    pub protocol: String,
    pub target_host: String,
    pub datastore: Option<String>,
}

#[derive(Serialize)]
pub struct RestoreSessionResponse {
    pub session_id: String,
    pub snapshot_id: String,
    pub restore_type: String,
    pub status: String,
    pub progress_pct: f64,
    pub target: String,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub size: i64,
    pub is_directory: bool,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/vm", axum::routing::post(restore_vm))
        .route("/file", axum::routing::post(restore_file))
        .route("/instant", axum::routing::post(instant_recovery))
        .route("/instant/:id/stop", axum::routing::post(stop_instant_recovery))
        .route("/explore/:snapshot_id", axum::routing::get(browse_snapshot))
        .route("/surebackup", axum::routing::post(start_surebackup))
        .route("/session/:id", axum::routing::get(get_session))
}

async fn restore_vm(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VmRestoreRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    let snapshot = lookup_snapshot(&state.db, &req.snapshot_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let session = RestoreSession {
        id: uuid::Uuid::new_v4().to_string(),
        snapshot_id: req.snapshot_id.clone(),
        restore_type: RestoreType::FullVm,
        status: RestoreStatus::Running,
        progress_pct: 0.0,
        bytes_processed: 0,
        total_bytes: snapshot.size_bytes.max(0) as u64,
        target: req.target_datastore.clone(),
        started_at: chrono::Utc::now().timestamp(),
        finished_at: None,
        error: None,
    };

    let resp = session_to_response(&session);
    let sid = session.id.clone();
    state.restore_tracker.create(session).await;

    // Background restore task
    let state = state.clone();
    tokio::spawn(async move {
        let result = perform_vm_restore(&state, &req).await;
        match result {
            Ok(bytes) => {
                state.restore_tracker.update(&sid, |s| {
                    s.status = RestoreStatus::Completed;
                    s.progress_pct = 100.0;
                    s.bytes_processed = bytes;
                    s.finished_at = Some(chrono::Utc::now().timestamp());
                }).await;
            }
            Err(e) => {
                state.restore_tracker.update(&sid, |s| {
                    s.status = RestoreStatus::Failed(e.to_string());
                    s.finished_at = Some(chrono::Utc::now().timestamp());
                }).await;
            }
        }
    });

    Ok(Json(resp))
}

async fn restore_file(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FileRestoreRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    let snapshot = lookup_snapshot(&state.db, &req.snapshot_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let session = RestoreSession {
        id: uuid::Uuid::new_v4().to_string(),
        snapshot_id: req.snapshot_id.clone(),
        restore_type: RestoreType::FileLevel,
        status: RestoreStatus::Running,
        progress_pct: 0.0,
        bytes_processed: 0,
        total_bytes: snapshot.size_bytes.max(0) as u64,
        target: req.target_path.clone(),
        started_at: chrono::Utc::now().timestamp(),
        finished_at: None,
        error: None,
    };

    let resp = session_to_response(&session);
    let sid = session.id.clone();
    state.restore_tracker.create(session).await;

    let state = state.clone();
    tokio::spawn(async move {
        let result = perform_file_restore(&state, &req).await;
        match result {
            Ok(bytes) => {
                state.restore_tracker.update(&sid, |s| {
                    s.status = RestoreStatus::Completed;
                    s.progress_pct = 100.0;
                    s.bytes_processed = bytes;
                    s.finished_at = Some(chrono::Utc::now().timestamp());
                }).await;
            }
            Err(e) => {
                state.restore_tracker.update(&sid, |s| {
                    s.status = RestoreStatus::Failed(e.to_string());
                    s.finished_at = Some(chrono::Utc::now().timestamp());
                }).await;
            }
        }
    });

    Ok(Json(resp))
}

async fn instant_recovery(
    State(state): State<Arc<AppState>>,
    Json(req): Json<InstantRecoveryRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    let _snapshot = lookup_snapshot(&state.db, &req.snapshot_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let protocol = match req.protocol.to_lowercase().as_str() {
        "nfs" => RestoreType::InstantNfs,
        "iscsi" => RestoreType::InstantIscsi,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let session = RestoreSession {
        id: uuid::Uuid::new_v4().to_string(),
        snapshot_id: req.snapshot_id.clone(),
        restore_type: protocol,
        status: RestoreStatus::Running,
        progress_pct: 0.0,
        bytes_processed: 0,
        total_bytes: 0,
        target: format!("{}:{}", req.target_host, req.protocol),
        started_at: chrono::Utc::now().timestamp(),
        finished_at: None,
        error: None,
    };

    let resp = session_to_response(&session);
    state.restore_tracker.create(session).await;
    Ok(Json(resp))
}

async fn stop_instant_recovery(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> StatusCode {
    let session = state.restore_tracker.get(&id).await;
    match session {
        Some(s) if matches!(s.restore_type, RestoreType::InstantNfs | RestoreType::InstantIscsi) => {
            state.restore_tracker.update(&id, |s| {
                s.status = RestoreStatus::Cancelled;
                s.finished_at = Some(chrono::Utc::now().timestamp());
            }).await;
            StatusCode::OK
        }
        Some(_) => StatusCode::BAD_REQUEST,
        None => StatusCode::NOT_FOUND,
    }
}

async fn browse_snapshot(
    State(state): State<Arc<AppState>>,
    Path(snapshot_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    let _snapshot = lookup_snapshot(&state.db, &snapshot_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let prefix = params.get("prefix").map(|s| s.as_str()).unwrap_or("");

    // Load manifest from index
    let index_str = state.config.storage.default_path.to_string_lossy().to_string();
    let explorer = crate::restore::explorer::GuestFileExplorer::new(&index_str)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let files = explorer.list_files(&snapshot_id, prefix).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let entries: Vec<serde_json::Value> = files.into_iter().map(|f| {
        serde_json::json!({
            "path": f.path,
            "size": f.size,
            "modified_at": f.modified_at,
            "is_directory": f.is_directory,
            "owner": f.owner,
        })
    }).collect();

    Ok(Json(entries))
}

async fn start_surebackup(
    State(_state): State<Arc<AppState>>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    let session = state.restore_tracker.get(&id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(session_to_response(&session)))
}

// ---- helpers ----

fn session_to_response(s: &RestoreSession) -> RestoreSessionResponse {
    RestoreSessionResponse {
        session_id: s.id.clone(),
        snapshot_id: s.snapshot_id.clone(),
        restore_type: format!("{:?}", s.restore_type),
        status: format!("{:?}", s.status),
        progress_pct: s.progress_pct,
        target: s.target.clone(),
    }
}

async fn lookup_snapshot(db: &DbPool, snapshot_id: &str) -> Result<SnapshotModel, sqlx::Error> {
    match db {
        DbPool::Sqlite(pool) => {
            sqlx::query_as::<_, SnapshotModel>(
                "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                        size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                        app_consistent, created_at
                 FROM snapshots WHERE id = $1"
            )
            .bind(snapshot_id)
            .fetch_one(pool)
            .await
        }
        DbPool::Postgres(pool) => {
            sqlx::query_as::<_, SnapshotModel>(
                "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                        size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                        app_consistent, created_at
                 FROM snapshots WHERE id = $1"
            )
            .bind(snapshot_id)
            .fetch_one(pool)
            .await
        }
    }
}

async fn lookup_repository(db: &DbPool, repo_id: &str) -> Result<RepositoryModel, anyhow::Error> {
    match db {
        DbPool::Sqlite(pool) => {
            let row = sqlx::query_as::<_, RepositoryModel>(
                "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                        free_bytes, encrypted, immutable, status, created_at, updated_at
                 FROM repositories WHERE id = ?1"
            )
            .bind(repo_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Repository not found: {}", repo_id))?;
            Ok(row)
        }
        DbPool::Postgres(pool) => {
            let row = sqlx::query_as::<_, RepositoryModel>(
                "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                        free_bytes, encrypted, immutable, status, created_at, updated_at
                 FROM repositories WHERE id = $1"
            )
            .bind(repo_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Repository not found: {}", repo_id))?;
            Ok(row)
        }
    }
}

fn build_storage(repo: &RepositoryModel) -> impl std::future::Future<Output = anyhow::Result<Box<dyn crate::storage::StorageBackend>>> + 'static {
    let repo_type = repo.repo_type.clone();
    let config_json = repo.config_json.clone();
    async move {
        let cfg: serde_json::Value = serde_json::from_str(&config_json)
            .unwrap_or_else(|_| serde_json::json!({}));

        let storage_config = crate::storage::StorageConfig {
            backend_type: repo_type,
            path: cfg["path"].as_str().map(|s| s.to_string()),
            bucket: cfg["bucket"].as_str().map(|s| s.to_string()),
            region: cfg["region"].as_str().map(|s| s.to_string()),
            endpoint: cfg["endpoint"].as_str().map(|s| s.to_string()),
            access_key: cfg["access_key"].as_str().map(|s| s.to_string()),
            secret_key: cfg["secret_key"].as_str().map(|s| s.to_string()),
            container: cfg["container"].as_str().map(|s| s.to_string()),
            connection_string: cfg["connection_string"].as_str().map(|s| s.to_string()),
        };
        crate::storage::create_backend(storage_config).await
    }
}

fn encryption_key(state: &AppState) -> Option<Vec<u8>> {
    let key_path = state.config.encryption.key_path.clone()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| state.config.storage.default_path.join("encryption.key"));
    if key_path.exists() {
        std::fs::read(&key_path).ok()
    } else {
        None
    }
}

async fn perform_vm_restore(
    state: &Arc<AppState>,
    req: &VmRestoreRequest,
) -> Result<u64, anyhow::Error> {
    use crate::restore::RestoreOrchestrator;

    let snapshot = lookup_snapshot(&state.db, &req.snapshot_id).await?;
    let repo = lookup_repository(&state.db, &snapshot.repository_id).await?;
    let storage = build_storage(&repo).await?;
    let key = encryption_key(state);

    let index_str = state.config.storage.default_path.to_string_lossy().to_string();
    let orchestrator = RestoreOrchestrator::new(&index_str)?;

    let session = orchestrator.restore_vm(
        &req.snapshot_id,
        &req.target_datastore,
        storage.as_ref(),
        key.as_deref(),
        None,
    ).await?;

    crate::db::record_event(
        &state.db,
        "restore_completed",
        "restore",
        &format!("VM restore completed: snapshot {}", req.snapshot_id),
        None,
        Some(&session.id),
    ).await.ok();

    Ok(session.bytes_processed)
}

async fn perform_file_restore(
    state: &Arc<AppState>,
    req: &FileRestoreRequest,
) -> Result<u64, anyhow::Error> {
    use crate::restore::RestoreOrchestrator;

    let snapshot = lookup_snapshot(&state.db, &req.snapshot_id).await?;
    let repo = lookup_repository(&state.db, &snapshot.repository_id).await?;
    let storage = build_storage(&repo).await?;
    let key = encryption_key(state);

    let index_str = state.config.storage.default_path.to_string_lossy().to_string();
    let orchestrator = RestoreOrchestrator::new(&index_str)?;

    let session = orchestrator.restore_file(
        &req.snapshot_id,
        &req.files,
        &req.target_path,
        storage.as_ref(),
        key.as_deref(),
        req.overwrite.unwrap_or(false),
    ).await?;

    crate::db::record_event(
        &state.db,
        "restore_completed",
        "restore",
        &format!("File restore completed: snapshot {} -> {}", req.snapshot_id, req.target_path),
        None,
        Some(&session.id),
    ).await.ok();

    Ok(session.bytes_processed)
}
