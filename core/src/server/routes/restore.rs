use axum::{
    extract::{Extension, Path, State, Query},
    Json,
    body::Body,
    http::StatusCode,
    response::Response,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use crate::auth::jwt::Claims;
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
    pub hypervisor_id: Option<String>,
}

/// Does the caller's tenant own this snapshot? Super-admins and global users
/// (no tenant) pass through; tenant-scoped callers are confined to their own.
fn tenant_allows(claims: &Claims, owner: Option<&str>) -> bool {
    if claims.role == "super_admin" {
        return true;
    }
    match &claims.tenant_id {
        None => true,
        Some(mine) => owner == Some(mine.as_str()),
    }
}

/// SEC-020: validate the user-supplied `target_path` for a file restore to
/// prevent arbitrary file writes on the daemon host. The path must be a
/// plain relative path or an absolute path that lives under the configured
/// restore root (when one is configured). System-critical directories and
/// Windows drive roots are always rejected.
fn validate_restore_target(target: &str) -> Result<(), String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("target_path must not be empty".into());
    }
    // Reject NUL bytes and other control characters.
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("target_path contains control characters".into());
    }
    let p = std::path::Path::new(trimmed);
    // If a restore root is configured, reject anything outside it.
    if let Ok(root) = std::env::var("BCK_RESTORE_ROOT") {
        let root = std::path::Path::new(&root);
        if !p.exists() && !p.starts_with(root) {
            return Err(format!(
                "target_path '{}' is outside the configured restore root",
                trimmed
            ));
        }
        if p.exists() {
            // Canonicalize both sides to detect ../ escapes.
            if let (Ok(canon_target), Ok(canon_root)) = (p.canonicalize(), root.canonicalize()) {
                if !canon_target.starts_with(&canon_root) {
                    return Err(format!(
                        "target_path '{}' is outside the configured restore root",
                        trimmed
                    ));
                }
            }
        }
    }
    // Reject obviously dangerous Unix system directories.
    #[cfg(unix)]
    {
        const BLOCKED: &[&str] = &[
            "/", "/bin", "/sbin", "/etc", "/boot", "/proc", "/sys", "/dev",
            "/var/log", "/usr", "/lib", "/lib64",
        ];
        for b in BLOCKED {
            let bp = std::path::Path::new(b);
            if trimmed == *b || trimmed.starts_with(&format!("{}/", b)) {
                if trimmed == *b {
                    return Err(format!("target_path '{}' is a system directory", trimmed));
                }
                // Only block if the canonical target matches (avoid
                // false positives on similarly-named user directories).
                if let Ok(canon) = p.canonicalize() {
                    if canon == bp {
                        return Err(format!("target_path '{}' is a system directory", trimmed));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Load a snapshot and enforce the caller's tenant on it.
async fn scoped_snapshot(state: &AppState, claims: &Claims, snapshot_id: &str) -> Result<SnapshotModel, StatusCode> {
    let snapshot = lookup_snapshot(&state.db, snapshot_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !tenant_allows(claims, snapshot.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(snapshot)
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

#[derive(Deserialize)]
pub struct VmInstantRecoveryRequest {
    pub snapshot_id: String,
    pub vm_name: String,
    pub hypervisor_id: String,
    pub protocol: String,
    pub target_host: String,
    pub datastore: Option<String>,
    #[serde(default)]
    pub power_on: bool,
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
        .route("/instant", axum::routing::get(list_instant_recovery))
        .route("/instant/vm", axum::routing::post(instant_recovery_vm))
        .route("/instant/:id/stop", axum::routing::post(stop_instant_recovery))
        .route("/explore/:snapshot_id", axum::routing::get(browse_snapshot))
        .route("/explore/:snapshot_id/file", axum::routing::get(download_file))
        .route("/surebackup", axum::routing::post(start_surebackup))
        .route("/surebackup", axum::routing::get(list_surebackup))
        .route("/surebackup/:id", axum::routing::get(get_surebackup))
        .route("/session/:id", axum::routing::get(get_session))
}

async fn restore_vm(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<VmRestoreRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    let snapshot = scoped_snapshot(&state, &claims, &req.snapshot_id).await?;

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
    Extension(claims): Extension<Claims>,
    Json(req): Json<FileRestoreRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    // SEC-020: validate the target path before any work begins.
    if let Err(msg) = validate_restore_target(&req.target_path) {
        tracing::warn!(
            "restore_file: rejected target_path for sub={} reason={}",
            claims.sub,
            msg
        );
        return Err(StatusCode::BAD_REQUEST);
    }
    let snapshot = scoped_snapshot(&state, &claims, &req.snapshot_id).await?;

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
    Extension(claims): Extension<Claims>,
    Json(req): Json<InstantRecoveryRequest>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    let snapshot = scoped_snapshot(&state, &claims, &req.snapshot_id).await?;
    let repo = lookup_repository(&state.db, &snapshot.repository_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let storage = build_storage(&repo, encryption_key(&state)).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let index_str = state.config.storage.default_path.to_string_lossy().to_string();

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
    let sid = session.id.clone();
    let snap_id = req.snapshot_id.clone();
    let vm_name = req.vm_name.clone();
    let listen = req.target_host.clone();
    state.restore_tracker.create(session).await;

    // Start the actual NFS/iSCSI server in the background.
    let registry = state.instant_recovery.clone();
    let index_str2 = index_str.clone();
    tokio::spawn(async move {
        let result = match req.protocol.to_lowercase().as_str() {
            "nfs" => registry.start_nfs(&index_str2, storage, &snap_id, &vm_name, "", &listen).await,
            _ => registry.start_iscsi(&index_str2, storage, &snap_id, &vm_name, "", &listen).await,
        };
        match result {
            Ok(_) => {
                state.restore_tracker.update(&sid, |s| {
                    s.progress_pct = 100.0;
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

async fn stop_instant_recovery(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Tenant check: verify the caller owns the snapshot behind the session.
    if let Some(s) = state.restore_tracker.get(&id).await {
        if let Ok(snap) = lookup_snapshot(&state.db, &s.snapshot_id).await {
            if !tenant_allows(&claims, snap.tenant_id.as_deref()) {
                return Err(StatusCode::NOT_FOUND);
            }
        }
    } else {
        return Err(StatusCode::NOT_FOUND);
    }
    let session = state.restore_tracker.get(&id).await;
    match session {
        Some(s) if matches!(s.restore_type, RestoreType::InstantNfs | RestoreType::InstantIscsi) => {
            // Stop the actual server and mark the session cancelled.
            let _ = state.instant_recovery.stop_session(&id).await;
            state.restore_tracker.update(&id, |s| {
                s.status = RestoreStatus::Cancelled;
                s.finished_at = Some(chrono::Utc::now().timestamp());
            }).await;
            Ok(StatusCode::OK)
        }
        Some(_) => Err(StatusCode::BAD_REQUEST),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Serialize)]
pub struct InstantRecoveryListEntry {
    pub session_id: String,
    pub snapshot_id: String,
    pub vm_name: String,
    pub protocol: String,
    pub mount_path: String,
    pub target_host: String,
    pub status: String,
    pub progress_pct: f64,
    pub bytes_migrated: u64,
    pub total_bytes: u64,
    pub hypervisor_id: Option<String>,
    pub vm_ref: Option<String>,
}

async fn list_instant_recovery(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<InstantRecoveryListEntry>>, StatusCode> {
    let sessions = state.instant_recovery.list_sessions().await;
    // Filter sessions by tenant ownership (check underlying snapshot).
    let mut allowed_ids = std::collections::HashSet::new();
    for s in &sessions {
        if let Ok(snap) = lookup_snapshot(&state.db, &s.snapshot_id).await {
            if tenant_allows(&claims, snap.tenant_id.as_deref()) {
                allowed_ids.insert(s.id.clone());
            }
        } else if claims.tenant_id.is_none() || claims.role == "super_admin" {
            // If snapshot not found (legacy), allow global admins.
            allowed_ids.insert(s.id.clone());
        }
    }
    let entries = sessions.into_iter().filter(|s| allowed_ids.contains(&s.id)).map(|s| {
        InstantRecoveryListEntry {
            session_id: s.id,
            snapshot_id: s.snapshot_id,
            vm_name: s.vm_name,
            protocol: format!("{:?}", s.protocol),
            mount_path: s.mount_path,
            target_host: s.target_host,
            status: format!("{:?}", s.status),
            progress_pct: s.progress_pct,
            bytes_migrated: s.bytes_migrated,
            total_bytes: s.total_bytes,
            hypervisor_id: s.hypervisor_id,
            vm_ref: s.vm_ref,
        }
    }).collect();
    Ok(Json(entries))
}

/// Instant recovery for a VM on a target hypervisor (VMware / Hyper-V):
/// starts the NFS/iSCSI export from the snapshot and registers the VM on the
/// hypervisor so it boots directly from the backup. Stopping the session
/// unregisters the VM.
async fn instant_recovery_vm(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<VmInstantRecoveryRequest>,
) -> Result<(StatusCode, Json<RestoreSessionResponse>), StatusCode> {
    let protocol = match req.protocol.to_lowercase().as_str() {
        "nfs" => RestoreType::InstantNfs,
        "iscsi" => RestoreType::InstantIscsi,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let snapshot = scoped_snapshot(&state, &claims, &req.snapshot_id).await?;
    let repo = lookup_repository(&state.db, &snapshot.repository_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let storage = build_storage(&repo, encryption_key(&state)).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let hv = crate::server::routes::hypervisors::fetch_hypervisor(&state.db, &req.hypervisor_id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let connector = crate::server::routes::hypervisors::connector_from_model(&hv, encryption_key(&state).as_deref())
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let index_str = state.config.storage.default_path.to_string_lossy().to_string();

    let session = RestoreSession {
        id: uuid::Uuid::new_v4().to_string(),
        snapshot_id: req.snapshot_id.clone(),
        restore_type: protocol,
        status: RestoreStatus::Running,
        progress_pct: 0.0,
        bytes_processed: 0,
        total_bytes: 0,
        target: format!("hypervisor:{}", req.hypervisor_id),
        started_at: chrono::Utc::now().timestamp(),
        finished_at: None,
        error: None,
    };

    let resp = session_to_response(&session);
    let sid = session.id.clone();
    let snap_id = req.snapshot_id.clone();
    let vm_name = req.vm_name.clone();
    let listen = req.target_host.clone();
    let proto = req.protocol.clone();
    let datastore = req.datastore.clone().unwrap_or_default();
    let hypervisor_id = req.hypervisor_id.clone();
    let power_on = req.power_on;
    state.restore_tracker.create(session).await;

    let registry = state.instant_recovery.clone();
    tokio::spawn(async move {
        let result = registry.start_hypervisor(
            &index_str,
            storage,
            &snap_id,
            &vm_name,
            &proto,
            &listen,
            &hypervisor_id,
            connector,
            &datastore,
            power_on,
        ).await;
        match result {
            Ok(_) => {
                state.restore_tracker.update(&sid, |s| {
                    s.progress_pct = 100.0;
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

    Ok((StatusCode::ACCEPTED, Json(resp)))
}

async fn browse_snapshot(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(snapshot_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    let _snapshot = scoped_snapshot(&state, &claims, &snapshot_id).await?;

    let dir = params.get("dir")
        .or_else(|| params.get("prefix"))
        .cloned()
        .unwrap_or_else(|| "/".to_string());

    // Load manifest from index
    let index_str = state.config.storage.default_path.to_string_lossy().to_string();
    let explorer = crate::restore::explorer::GuestFileExplorer::new(&index_str)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let files = explorer.list_directory(&snapshot_id, &dir).await
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

/// Download (or preview) a single file from a snapshot, reassembled from the
/// block store on the fly.
async fn download_file(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(snapshot_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, StatusCode> {
    let path = params.get("path").ok_or(StatusCode::BAD_REQUEST)?;
    let snapshot = scoped_snapshot(&state, &claims, &snapshot_id).await?;
    let repo = lookup_repository(&state.db, &snapshot.repository_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let storage = build_storage(&repo, encryption_key(&state)).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let key = encryption_key(&state);

    let index_str = state.config.storage.default_path.to_string_lossy().to_string();
    let explorer = crate::restore::explorer::GuestFileExplorer::new(&index_str)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let data = explorer.extract_file(&snapshot_id, path, storage.as_ref(), key.as_deref())
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let response = Response::builder()
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", data.len().to_string())
        .body(Body::from(data))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(response)
}

#[derive(Deserialize)]
pub struct SureBackupRequest {
    pub snapshot_id: String,
    pub vm_name: String,
    pub target_host: Option<String>,
}

#[derive(Serialize)]
pub struct SureBackupResponse {
    pub job_id: String,
    pub status: String,
}

async fn start_surebackup(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<SureBackupRequest>,
) -> Result<Json<SureBackupResponse>, StatusCode> {
    use crate::restore::surebackup::{SureBackupStatus, TestResult};

    let snapshot = scoped_snapshot(&state, &claims, &req.snapshot_id).await?;
    let repo = lookup_repository(&state.db, &snapshot.repository_id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let storage = build_storage(&repo, encryption_key(&state)).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let job = state
        .surebackup
        .start_verification_for_tenant(&req.snapshot_id, &req.vm_name, claims.tenant_id.clone())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let jid = job.id.clone();
    let jid_task = jid.clone();

    let index_str = state.config.storage.default_path.to_string_lossy().to_string();
    let listen = req.target_host.clone().unwrap_or_default();
    let state = state.clone();

    // Drive the verification in the background:
    //  1. start instant recovery (isolated lab) for the snapshot
    //  2. run network + heartbeat tests against the recovered target
    //  3. stop the recovery session and mark the job complete
    tokio::spawn(async move {
        let _ = state.surebackup.update_job(&jid_task, |j| {
            j.status = SureBackupStatus::CreatingLab;
        }).await;

        let session = state.instant_recovery
            .start_nfs(&index_str, storage, &req.snapshot_id, &req.vm_name, "", &listen)
            .await;

        let session = match session {
            Ok(s) => s,
            Err(e) => {
                let _ = state.surebackup.update_job(&jid_task, |j| {
                    j.status = SureBackupStatus::Failed(e.to_string());
                    j.completed_at = Some(chrono::Utc::now().timestamp());
                }).await;
                return;
            }
        };

        let _ = state.surebackup.update_job(&jid_task, |j| {
            j.status = SureBackupStatus::BootingVm;
        }).await;

        // Give the recovery server a moment to accept connections.
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let target_ip = session.target_host.clone();
        let mut results: Vec<TestResult> = Vec::new();
        for test in ["ping", "heartbeat"] {
            let result = state.surebackup.run_test(&target_ip, test).await
                .unwrap_or_else(|e| TestResult {
                    test_name: test.to_string(),
                    status: "error".into(),
                    message: e.to_string(),
                    duration_seconds: 0,
                });
            results.push(result);
        }

        let _ = state.surebackup.update_job(&jid_task, |j| {
            j.status = SureBackupStatus::RunningTests;
            j.test_results = results;
        }).await;

        let _ = state.instant_recovery.stop_session(&session.id).await;

        let _ = state.surebackup.update_job(&jid_task, |j| {
            j.status = SureBackupStatus::Completed;
            j.completed_at = Some(chrono::Utc::now().timestamp());
        }).await;
    });

    Ok(Json(SureBackupResponse {
        job_id: jid.clone(),
        status: "pending".into(),
    }))
}

async fn get_surebackup(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<crate::restore::surebackup::SureBackupJob>, StatusCode> {
    let job = state
        .surebackup
        .get_job(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    // SEC-019: tenant scope.
    if !tenant_allows(&claims, job.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(job))
}

async fn list_surebackup(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<crate::restore::surebackup::SureBackupJob>>, StatusCode> {
    // SEC-019: filter by tenant scope.
    let all = state.surebackup.get_status().await;
    let scoped: Vec<_> = all
        .into_iter()
        .filter(|j| tenant_allows(&claims, j.tenant_id.as_deref()))
        .collect();
    Ok(Json(scoped))
}

async fn get_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<RestoreSessionResponse>, StatusCode> {
    let session = state
        .restore_tracker
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    // SEC-019: verify the caller's tenant owns the snapshot behind this
    // session to avoid leaking session metadata across tenants.
    if let Ok(snap) = lookup_snapshot(&state.db, &session.snapshot_id).await {
        if !tenant_allows(&claims, snap.tenant_id.as_deref()) {
            return Err(StatusCode::NOT_FOUND);
        }
    }
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
                        app_consistent, created_at, tenant_id
                 FROM snapshots WHERE id = ?1"
            )
            .bind(snapshot_id)
            .fetch_one(pool)
            .await
        }
        DbPool::Postgres(pool) => {
            sqlx::query_as::<_, SnapshotModel>(
                "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                        size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                        app_consistent, created_at, tenant_id
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
                        free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
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
                        free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
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

fn build_storage(repo: &RepositoryModel, key: Option<Vec<u8>>) -> impl std::future::Future<Output = anyhow::Result<Box<dyn crate::storage::StorageBackend>>> + 'static {
    let repo_type = repo.repo_type.clone();
    let config_json = repo.config_json.clone();
    async move {
        let cfg: serde_json::Value = serde_json::from_str(&config_json)
            .unwrap_or_else(|_| serde_json::json!({}));

        let mut storage_config = crate::storage::storage_config_from_json(&cfg, key.as_deref());
        storage_config.backend_type = repo_type;
        crate::storage::create_backend(storage_config).await
    }
}

fn encryption_key(state: &AppState) -> Option<Vec<u8>> {
    crate::encrypt::app_key(&state.config).ok()
}

async fn perform_vm_restore(
    state: &Arc<AppState>,
    req: &VmRestoreRequest,
) -> Result<u64, anyhow::Error> {
    use crate::restore::RestoreOrchestrator;

    let snapshot = lookup_snapshot(&state.db, &req.snapshot_id).await?;
    let repo = lookup_repository(&state.db, &snapshot.repository_id).await?;
    let storage = build_storage(&repo, encryption_key(&state)).await?;
    let key = encryption_key(&state);

    // Optional: build a hypervisor connector so the restored VM can be
    // re-registered on the source hypervisor.
    let connector: Option<Box<dyn crate::integrations::HypervisorConnector>> = match &req.hypervisor_id {
        Some(hv_id) => {
            let hv = super::hypervisors::fetch_hypervisor(&state.db, hv_id).await?
                .ok_or_else(|| anyhow::anyhow!("Hypervisor not found: {}", hv_id))?;
            Some(super::hypervisors::connector_from_model(&hv, encryption_key(&state).as_deref())?)
        }
        None => None,
    };
    let vm_name = req.vm_name.clone()
        .unwrap_or_else(|| format!("bck-restore-{}", &req.snapshot_id[..req.snapshot_id.len().min(12)]));

    let index_str = state.config.storage.default_path.to_string_lossy().to_string();
    let orchestrator = RestoreOrchestrator::new(&index_str)?;

    let session = orchestrator.restore_vm(
        &req.snapshot_id,
        &req.target_datastore,
        storage.as_ref(),
        key.as_deref(),
        connector.as_deref(),
        &vm_name,
        req.power_on,
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
    let storage = build_storage(&repo, encryption_key(&state)).await?;
    let key = encryption_key(&state);

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
