use anyhow::{Result, anyhow};
use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::db::models::hypervisor::HypervisorModel;
use crate::db::models::vm::VmModel;
use crate::db::DbPool;
use crate::integrations::{HypervisorConnector, PowerState, VmInfo};
use crate::server::AppState;

#[derive(Serialize, Deserialize)]
pub struct HypervisorResponse {
    pub id: String,
    pub name: String,
    pub hv_type: String,
    pub host: String,
    pub port: i32,
    pub status: String,
    pub version: Option<String>,
    pub created_at: i64,
}

impl From<HypervisorModel> for HypervisorResponse {
    fn from(h: HypervisorModel) -> Self {
        Self {
            id: h.id,
            name: h.name,
            hv_type: h.hv_type,
            host: h.host,
            port: h.port,
            status: h.status,
            version: h.version,
            created_at: h.created_at,
        }
    }
}

#[derive(Deserialize)]
pub struct AddHypervisorRequest {
    pub name: String,
    pub hv_type: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub ignore_ssl: Option<bool>,
}

#[derive(Serialize)]
pub struct TestResult {
    pub ok: bool,
    pub status: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct VmResponse {
    pub id: String,
    pub name: String,
    pub hypervisor_id: String,
    pub mo_ref: String,
    pub power_state: String,
    pub os: Option<String>,
    pub cpu_count: i32,
    pub ram_mb: i64,
    pub disk_gb: i64,
    pub protection_status: String,
    pub last_backup: Option<i64>,
}

impl From<VmModel> for VmResponse {
    fn from(v: VmModel) -> Self {
        Self {
            id: v.id,
            name: v.name,
            hypervisor_id: v.hypervisor_id,
            mo_ref: v.mo_ref,
            power_state: v.power_state.unwrap_or_else(|| "unknown".into()),
            os: v.os,
            cpu_count: v.cpu_count,
            ram_mb: v.ram_mb,
            disk_gb: v.disk_gb,
            protection_status: v.protection_status,
            last_backup: v.last_backup,
        }
    }
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_hypervisors).post(add_hypervisor))
        .route("/:id", axum::routing::get(get_hypervisor).delete(delete_hypervisor))
        .route("/:id/test", axum::routing::post(test_hypervisor))
        .route("/:id/vms", axum::routing::get(list_vms))
}

fn connector_from_request(req: &AddHypervisorRequest) -> Result<Box<dyn HypervisorConnector>> {
    // For Hyper-V the WinRM TLS port is 5986 (or 443); everything else is plain HTTP.
    let use_ssl = req.port == 5986 || req.port == 443;
    match req.hv_type.to_lowercase().as_str() {
        "hyperv" => Ok(crate::integrations::hyperv::create_connector(
            &req.host, &req.username, &req.password, use_ssl,
        )),
        "vmware" | "esxi" | "vsphere" => Ok(crate::integrations::vmware::create_connector(
            &req.host, req.port, &req.username, &req.password, req.ignore_ssl.unwrap_or(false),
        )),
        other => Err(anyhow!("Unsupported hypervisor type: {}", other)),
    }
}

pub(crate) fn connector_from_model(m: &HypervisorModel) -> Result<Box<dyn HypervisorConnector>> {
    let creds: serde_json::Value = serde_json::from_str(&m.credentials_json)
        .unwrap_or_else(|_| serde_json::json!({}));
    let username = creds["username"].as_str().unwrap_or("").to_string();
    let password = creds["password"].as_str().unwrap_or("").to_string();
    let ignore_ssl = creds["ignore_ssl"].as_bool().unwrap_or(false);
    let use_ssl = m.port == 5986 || m.port == 443;

    match m.hv_type.to_lowercase().as_str() {
        "hyperv" => Ok(crate::integrations::hyperv::create_connector(
            &m.host, &username, &password, use_ssl,
        )),
        "vmware" | "esxi" | "vsphere" => Ok(crate::integrations::vmware::create_connector(
            &m.host, m.port as u16, &username, &password, ignore_ssl,
        )),
        other => Err(anyhow!("Unsupported hypervisor type: {}", other)),
    }
}

async fn list_hypervisors(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<HypervisorResponse>>, StatusCode> {
    let list = fetch_hypervisors(&state.db).await
        .map_err(|e| {
            tracing::error!("list hypervisors: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(list.into_iter().map(HypervisorResponse::from).collect()))
}

async fn add_hypervisor(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AddHypervisorRequest>,
) -> Result<(StatusCode, Json<HypervisorResponse>), StatusCode> {
    let connector = connector_from_request(&req)
        .map_err(|e| {
            tracing::error!("add hypervisor (unsupported type): {}", e);
            StatusCode::BAD_REQUEST
        })?;

    let status = match connector.test_connection().await {
        Ok(_) => "connected",
        Err(e) => {
            tracing::warn!("hypervisor {} test failed: {}", req.host, e);
            "error"
        }
    };

    let id = uuid::Uuid::new_v4().to_string();
    let t = chrono::Utc::now().timestamp();
    let credentials = serde_json::json!({
        "username": req.username,
        "password": req.password,
        "ignore_ssl": req.ignore_ssl.unwrap_or(false),
    });

    match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO hypervisors
                 (id, name, hv_type, host, port, credentials_json, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)"
            )
            .bind(&id)
            .bind(&req.name)
            .bind(&req.hv_type)
            .bind(&req.host)
            .bind(req.port as i32)
            .bind(credentials.to_string())
            .bind(status)
            .bind(t)
            .execute(pool)
            .await
            .map_err(|e| {
                tracing::error!("add hypervisor insert: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO hypervisors
                 (id, name, hv_type, host, port, credentials_json, status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)"
            )
            .bind(&id)
            .bind(&req.name)
            .bind(&req.hv_type)
            .bind(&req.host)
            .bind(req.port as i32)
            .bind(credentials.to_string())
            .bind(status)
            .bind(t)
            .execute(pool)
            .await
            .map_err(|e| {
                tracing::error!("add hypervisor insert: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
    }

    crate::db::record_event(
        &state.db,
        "hypervisor_added",
        "hypervisors",
        &format!("Hypervisor {} added ({}@{})", req.name, req.hv_type, req.host),
        None,
        None,
    ).await.ok();

    let model = fetch_hypervisor(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((StatusCode::CREATED, Json(model.into())))
}

async fn get_hypervisor(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<HypervisorResponse>, StatusCode> {
    let model = fetch_hypervisor(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(model.into()))
}

async fn delete_hypervisor(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let affected = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query("DELETE FROM hypervisors WHERE id = ?1")
                .bind(&id)
                .execute(pool)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .rows_affected()
        }
        DbPool::Postgres(pool) => {
            sqlx::query("DELETE FROM hypervisors WHERE id = $1")
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
    crate::db::record_event(
        &state.db,
        "hypervisor_deleted",
        "hypervisors",
        &format!("Hypervisor {} deleted", id),
        None,
        None,
    ).await.ok();
    Ok(StatusCode::NO_CONTENT)
}

async fn test_hypervisor(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<TestResult>, StatusCode> {
    let model = fetch_hypervisor(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let connector = connector_from_model(&model)
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let (ok, status, message) = match connector.test_connection().await {
        Ok(_) => (true, "connected", "Connection successful".to_string()),
        Err(e) => (false, "error", e.to_string()),
    };

    update_hypervisor_status(&state.db, &id, status).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(TestResult { ok, status: status.to_string(), message }))
}

/// Discover VMs on the hypervisor, persist them, and return the list.
async fn list_vms(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<VmResponse>>, StatusCode> {
    let model = fetch_hypervisor(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let connector = connector_from_model(&model)
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let vms = connector.list_vms().await
        .map_err(|e| {
            tracing::error!("discover VMs on {}: {}", model.host, e);
            StatusCode::BAD_GATEWAY
        })?;

    let mut responses = Vec::new();
    for vm in &vms {
        upsert_vm(&state.db, &id, vm).await
            .map_err(|e| {
                tracing::error!("persist VM {}: {}", vm.name, e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    }
    for vm in &vms {
        responses.push(vm_to_response(vm, &id));
    }

    crate::db::record_event(
        &state.db,
        "vms_discovered",
        "hypervisors",
        &format!("Discovered {} VM(s) on {}", responses.len(), model.name),
        None,
        None,
    ).await.ok();

    Ok(Json(responses))
}

fn vm_to_response(vm: &VmInfo, hypervisor_id: &str) -> VmResponse {
    let disk_gb = vm.disks.iter().map(|d| d.capacity_bytes.max(0) as u64 / (1024 * 1024 * 1024)).sum::<u64>() as i64;
    VmResponse {
        id: format!("{}-{}", hypervisor_id, vm.mo_ref),
        name: vm.name.clone(),
        hypervisor_id: hypervisor_id.to_string(),
        mo_ref: vm.mo_ref.clone(),
        power_state: match vm.power_state {
            PowerState::PoweredOn => "running".into(),
            PowerState::Suspended => "suspended".into(),
            PowerState::PoweredOff => "off".into(),
        },
        os: vm.os.clone(),
        cpu_count: vm.cpu_count,
        ram_mb: vm.ram_mb,
        disk_gb,
        protection_status: "unprotected".into(),
        last_backup: None,
    }
}

async fn upsert_vm(db: &DbPool, hypervisor_id: &str, vm: &VmInfo) -> Result<()> {
    let t = chrono::Utc::now().timestamp();
    let disk_gb = vm.disks.iter().map(|d| d.capacity_bytes.max(0) as u64 / (1024 * 1024 * 1024)).sum::<u64>() as i64;
    let power_state = match vm.power_state {
        PowerState::PoweredOn => Some("running".to_string()),
        PowerState::Suspended => Some("suspended".to_string()),
        PowerState::PoweredOff => Some("off".to_string()),
    };

    let existing: Option<String> = match db {
        DbPool::Sqlite(pool) => {
            sqlx::query_scalar("SELECT id FROM vms WHERE hypervisor_id = ?1 AND mo_ref = ?2")
                .bind(hypervisor_id)
                .bind(&vm.mo_ref)
                .fetch_optional(pool)
                .await?
        }
        DbPool::Postgres(pool) => {
            sqlx::query_scalar("SELECT id FROM vms WHERE hypervisor_id = $1 AND mo_ref = $2")
                .bind(hypervisor_id)
                .bind(&vm.mo_ref)
                .fetch_optional(pool)
                .await?
        }
    };

    match existing {
        Some(vm_id) => match db {
            DbPool::Sqlite(pool) => {
                sqlx::query(
                    "UPDATE vms SET name = ?1, power_state = ?2, os = ?3, cpu_count = ?4,
                            ram_mb = ?5, disk_gb = ?6, updated_at = ?7 WHERE id = ?8"
                )
                .bind(&vm.name)
                .bind(&power_state)
                .bind(&vm.os)
                .bind(vm.cpu_count)
                .bind(vm.ram_mb)
                .bind(disk_gb)
                .bind(t)
                .bind(&vm_id)
                .execute(pool)
                .await?;
            }
            DbPool::Postgres(pool) => {
                sqlx::query(
                    "UPDATE vms SET name = $1, power_state = $2, os = $3, cpu_count = $4,
                            ram_mb = $5, disk_gb = $6, updated_at = $7 WHERE id = $8"
                )
                .bind(&vm.name)
                .bind(&power_state)
                .bind(&vm.os)
                .bind(vm.cpu_count)
                .bind(vm.ram_mb)
                .bind(disk_gb)
                .bind(t)
                .bind(&vm_id)
                .execute(pool)
                .await?;
            }
        },
        None => {
            let id = format!("{}-{}", hypervisor_id, vm.mo_ref);
            match db {
                DbPool::Sqlite(pool) => {
                    sqlx::query(
                        "INSERT INTO vms
                         (id, name, hypervisor_id, mo_ref, power_state, os, cpu_count, ram_mb,
                          disk_gb, protection_status, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unprotected', ?10, ?10)"
                    )
                    .bind(&id)
                    .bind(&vm.name)
                    .bind(hypervisor_id)
                    .bind(&vm.mo_ref)
                    .bind(&power_state)
                    .bind(&vm.os)
                    .bind(vm.cpu_count)
                    .bind(vm.ram_mb)
                    .bind(disk_gb)
                    .bind(t)
                    .execute(pool)
                    .await?;
                }
                DbPool::Postgres(pool) => {
                    sqlx::query(
                        "INSERT INTO vms
                         (id, name, hypervisor_id, mo_ref, power_state, os, cpu_count, ram_mb,
                          disk_gb, protection_status, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unprotected', $10, $10)"
                    )
                    .bind(&id)
                    .bind(&vm.name)
                    .bind(hypervisor_id)
                    .bind(&vm.mo_ref)
                    .bind(&power_state)
                    .bind(&vm.os)
                    .bind(vm.cpu_count)
                    .bind(vm.ram_mb)
                    .bind(disk_gb)
                    .bind(t)
                    .execute(pool)
                    .await?;
                }
            }
        }
    }
    Ok(())
}

// ---- DB helpers ----

pub async fn fetch_hypervisors(db: &DbPool) -> Result<Vec<HypervisorModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query_as::<_, HypervisorModel>(
                "SELECT id, name, hv_type, host, port, credentials_json, ssl_thumbprint,
                        status, version, created_at, updated_at
                 FROM hypervisors ORDER BY created_at DESC"
            )
            .fetch_all(pool)
            .await?;
            Ok(rows)
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query_as::<_, HypervisorModel>(
                "SELECT id, name, hv_type, host, port, credentials_json, ssl_thumbprint,
                        status, version, created_at, updated_at
                 FROM hypervisors ORDER BY created_at DESC"
            )
            .fetch_all(pool)
            .await?;
            Ok(rows)
        }
    }
}

pub async fn fetch_hypervisor(db: &DbPool, id: &str) -> Result<Option<HypervisorModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let row = sqlx::query_as::<_, HypervisorModel>(
                "SELECT id, name, hv_type, host, port, credentials_json, ssl_thumbprint,
                        status, version, created_at, updated_at
                 FROM hypervisors WHERE id = ?1"
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
        DbPool::Postgres(pool) => {
            let row = sqlx::query_as::<_, HypervisorModel>(
                "SELECT id, name, hv_type, host, port, credentials_json, ssl_thumbprint,
                        status, version, created_at, updated_at
                 FROM hypervisors WHERE id = $1"
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
    }
}

async fn update_hypervisor_status(db: &DbPool, id: &str, status: &str) -> Result<()> {
    let t = chrono::Utc::now().timestamp();
    match db {
        DbPool::Sqlite(pool) => {
            sqlx::query("UPDATE hypervisors SET status = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(status)
                .bind(t)
                .bind(id)
                .execute(pool)
                .await?;
        }
        DbPool::Postgres(pool) => {
            sqlx::query("UPDATE hypervisors SET status = $1, updated_at = $2 WHERE id = $3")
                .bind(status)
                .bind(t)
                .bind(id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::jwt::JwtManager;
    use crate::config::AppConfig;
    use crate::job::JobManager;
    use crate::scheduler::Scheduler;
    use axum::body::Body;
    use axum::http::{Request, StatusCode as HttpStatus};
    use tower::ServiceExt;

    async fn test_state(db_path: &str) -> Arc<AppState> {
        let url = format!("sqlite://{}?mode=rwc", db_path.replace('\\', "/"));
        let config = AppConfig {
            database: crate::config::DatabaseConfig {
                url: url.clone(),
                pool_size: 2,
                migrate: true,
            },
            storage: crate::config::StorageConfig {
                default_path: std::path::PathBuf::from(db_path).join("backups"),
                temp_path: std::path::PathBuf::from(db_path).join("tmp"),
            },
            ..AppConfig::default()
        };

        let db = crate::db::DbPool::connect(&url, config.database.pool_size)
            .await
            .unwrap();
        db.migrate().await.unwrap();
        let job_manager = Arc::new(tokio::sync::Mutex::new(JobManager::new(db.clone(), config.clone())));
        let scheduler = Arc::new(tokio::sync::Mutex::new(Scheduler::new(job_manager.clone())));
        Arc::new(AppState {
            config,
            db,
            job_manager,
            scheduler,
            jwt: JwtManager::new(b"test-secret"),
            restore_tracker: crate::restore::tracker::RestoreTracker::new(),
            instant_recovery: crate::restore::instant::InstantRecoveryRegistry::new(),
            surebackup: crate::restore::surebackup::SureBackupEngine::new(),
            sso: crate::enterprise::sso::SsoManager::new(),
        })
    }

    async fn read_json<T: serde::de::DeserializeOwned>(resp: axum::response::Response) -> T {
        let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn hypervisor_crud_roundtrip() {
        let dir = std::env::temp_dir().join(format!("bck-hv-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let state = test_state(db_path.to_str().unwrap()).await;

        let app = router().with_state(state.clone());

        // Unsupported hypervisor type is rejected before connecting.
        let add = Request::builder()
            .method("POST")
            .uri("/")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"lab","hv_type":"nonsense","host":"h","port":5985,"username":"u","password":"p"}"#))
            .unwrap();
        let resp = app.clone().oneshot(add).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::BAD_REQUEST);

        // Hyper-V hypervisor — connection test fails (no such host), but the
        // record is still stored with status "error".
        let add = Request::builder()
            .method("POST")
            .uri("/")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"lab","hv_type":"hyperv","host":"hv.local","port":5985,"username":"u","password":"p"}"#))
            .unwrap();
        let resp = app.clone().oneshot(add).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::CREATED);
        let created: HypervisorResponse = read_json(resp).await;
        assert_eq!(created.status, "error");
        assert_eq!(created.hv_type, "hyperv");

        // List returns the record.
        let resp = app.clone().oneshot(
            Request::builder().method("GET").uri("/").body(Body::empty()).unwrap(),
        ).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::OK);
        let list: Vec<HypervisorResponse> = read_json(resp).await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, created.id);

        // Get single.
        let resp = app.clone().oneshot(
            Request::builder().method("GET").uri(format!("/{}", created.id)).body(Body::empty()).unwrap(),
        ).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::OK);

        // Delete.
        let resp = app.clone().oneshot(
            Request::builder().method("DELETE").uri(format!("/{}", created.id)).body(Body::empty()).unwrap(),
        ).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::NO_CONTENT);

        // Get after delete -> 404.
        let resp = app.clone().oneshot(
            Request::builder().method("GET").uri(format!("/{}", created.id)).body(Body::empty()).unwrap(),
        ).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::NOT_FOUND);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn test_hypervisor_on_missing_returns_404() {
        let dir = std::env::temp_dir().join(format!("bck-hv-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let state = test_state(db_path.to_str().unwrap()).await;
        let app = router().with_state(state.clone());

        let resp = app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/missing/test")
                .body(Body::empty())
                .unwrap(),
        ).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::NOT_FOUND);
        std::fs::remove_dir_all(&dir).ok();
    }
}
