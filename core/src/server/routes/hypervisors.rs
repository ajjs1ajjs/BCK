use anyhow::{Result, anyhow};
use axum::{
    extract::{Extension, Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::auth::policy::{can_manage_hypervisors, is_global_admin, tenant_allows};
use crate::db::models::hypervisor::HypervisorModel;
use crate::db::models::vm::VmModel;
use crate::db::DbPool;
use crate::integrations::{HypervisorConnector, PowerState, VmInfo};
use crate::job::JobView;
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
    pub tenant_id: Option<String>,
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
            tenant_id: h.tenant_id,
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
    /// Owning tenant; super_admin may set this explicitly, otherwise it is
    /// stamped from the caller's claims. Tenant-scoped admins may not
    /// override it.
    pub tenant_id: Option<String>,
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

#[derive(Deserialize)]
pub struct VmBackupRequest {
    pub repository_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub vm_name: Option<String>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub retention_days: Option<i32>,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_hypervisors).post(add_hypervisor))
        .route(
            "/:id",
            axum::routing::get(get_hypervisor).delete(delete_hypervisor),
        )
        .route("/:id/test", axum::routing::post(test_hypervisor))
        .route("/:id/vms", axum::routing::get(list_vms))
        .route(
            "/:id/vms/:vm_ref/backup",
            axum::routing::post(start_vm_backup),
        )
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

pub(crate) fn connector_from_model(
    m: &HypervisorModel,
    key: Option<&[u8]>,
) -> Result<Box<dyn HypervisorConnector>> {
    crate::db::hypervisor::connector_from_model(m, key)
}

fn app_key(state: &AppState) -> Option<Vec<u8>> {
    crate::encrypt::app_key(&state.config).ok()
}

async fn list_hypervisors(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<HypervisorResponse>>, StatusCode> {
    let list = fetch_hypervisors(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("list hypervisors: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    // Tenant scope: tenant-scoped users only see their own hypervisors.
    let filtered: Vec<HypervisorResponse> = list
        .into_iter()
        .map(HypervisorResponse::from)
        .filter(|h| tenant_allows(&claims, h.tenant_id.as_deref()))
        .collect();
    Ok(Json(filtered))
}

async fn add_hypervisor(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<AddHypervisorRequest>,
) -> Result<(StatusCode, Json<HypervisorResponse>), StatusCode> {
    if !can_manage_hypervisors(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    let connector = connector_from_request(&req).map_err(|e| {
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
    // The password is encrypted at rest with the application key so the DB file
    // alone does not expose hypervisor credentials.
    let password_enc = crate::encrypt::app_key(&state.config)
        .map_err(|e| {
            tracing::error!("hypervisor credential encryption key: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
        .and_then(|key| {
            crate::encrypt::encrypt_secret(&key, &req.password).map_err(|e| {
                tracing::error!("encrypt hypervisor password: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })
        })?;
    let credentials = serde_json::json!({
        "username": req.username,
        "password": password_enc,
        "ignore_ssl": req.ignore_ssl.unwrap_or(false),
    });

    // Tenant assignment: only super_admin can set an explicit tenant_id;
    // tenant-scoped admins and operators are stamped with their own tenant.
    let tenant_id = if is_global_admin(&claims) {
        req.tenant_id.clone()
    } else {
        claims.tenant_id.clone()
    };

    match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO hypervisors
                 (id, name, hv_type, host, port, credentials_json, status, tenant_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)"
            )
            .bind(&id)
            .bind(&req.name)
            .bind(&req.hv_type)
            .bind(&req.host)
            .bind(req.port as i32)
            .bind(credentials.to_string())
            .bind(status)
            .bind(&tenant_id)
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
                 (id, name, hv_type, host, port, credentials_json, status, tenant_id, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)"
            )
            .bind(&id)
            .bind(&req.name)
            .bind(&req.hv_type)
            .bind(&req.host)
            .bind(req.port as i32)
            .bind(credentials.to_string())
            .bind(status)
            .bind(&tenant_id)
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
    )
    .await
    .ok();

    let model = fetch_hypervisor(&state.db, &id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((StatusCode::CREATED, Json(model.into())))
}

async fn get_hypervisor(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<HypervisorResponse>, StatusCode> {
    let model = fetch_hypervisor(&state.db, &id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if !tenant_allows(&claims, model.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(model.into()))
}

async fn delete_hypervisor(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !can_manage_hypervisors(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    // Tenant check before destructive op.
    if let Ok(Some(model)) = fetch_hypervisor(&state.db, &id).await {
        if !tenant_allows(&claims, model.tenant_id.as_deref()) {
            return Err(StatusCode::NOT_FOUND);
        }
    } else {
        return Err(StatusCode::NOT_FOUND);
    }
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
    )
    .await
    .ok();
    Ok(StatusCode::NO_CONTENT)
}

async fn test_hypervisor(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<TestResult>, StatusCode> {
    let model = fetch_hypervisor(&state.db, &id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if !tenant_allows(&claims, model.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }

    let connector = connector_from_model(&model, app_key(&state).as_deref())
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let (ok, status, message) = match connector.test_connection().await {
        Ok(_) => (true, "connected", "Connection successful".to_string()),
        Err(e) => (false, "error", e.to_string()),
    };

    update_hypervisor_status(&state.db, &id, status)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(TestResult {
        ok,
        status: status.to_string(),
        message,
    }))
}

/// Discover VMs on the hypervisor, persist them, and return the list.
async fn list_vms(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<Vec<VmResponse>>, StatusCode> {
    let model = fetch_hypervisor(&state.db, &id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if !tenant_allows(&claims, model.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }

    let connector = connector_from_model(&model, app_key(&state).as_deref())
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let vms = connector.list_vms().await.map_err(|e| {
        tracing::error!("discover VMs on {}: {}", model.host, e);
        StatusCode::BAD_GATEWAY
    })?;

    let mut responses = Vec::new();
    for vm in &vms {
        upsert_vm(&state.db, &id, vm)
            .await
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
    )
    .await
    .ok();

    Ok(Json(responses))
}

/// Create and start a full VM backup job for the given VM on the hypervisor.
/// Tenant scope is enforced on both the hypervisor and the target repository.
async fn start_vm_backup(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((id, vm_ref)): Path<(String, String)>,
    Json(req): Json<VmBackupRequest>,
) -> Result<(StatusCode, Json<JobView>), StatusCode> {
    if !can_manage_hypervisors(&claims) {
        return Err(StatusCode::FORBIDDEN);
    }
    let hv = fetch_hypervisor(&state.db, &id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if !tenant_allows(&claims, hv.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }

    // Repository ownership check: prevent cross-tenant writes.
    let repo = crate::db::models::repository::RepositoryModel::fetch_by_id(&state.db, &req.repository_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if !tenant_allows(&claims, repo.tenant_id.as_deref()) {
        return Err(StatusCode::NOT_FOUND);
    }

    let tenant_id = claims.tenant_id.as_deref();
    let job_id = {
        let jm = state.job_manager.lock().await;
        jm.register_vm_job(
            req.name.as_deref().unwrap_or("vm-backup"),
            None,
            &id,
            &vm_ref,
            req.vm_name.as_deref(),
            &req.repository_id,
            req.schedule.as_deref(),
            req.retention_days,
            tenant_id,
        )
        .await
        .map_err(|e| {
            tracing::error!("register VM backup job: {}", e);
            StatusCode::BAD_REQUEST
        })?
    };

    {
        let jm = state.job_manager.lock().await;
        jm.start_job(&job_id).await.map_err(|e| {
            tracing::error!("start VM backup job: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

    let jm = state.job_manager.lock().await;
    let job = jm
        .get_job(&job_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    drop(jm);

    crate::db::record_event(
        &state.db,
        "vm_backup_started",
        "hypervisors",
        &format!(
            "VM backup job {} started for VM {} on hypervisor {}",
            job_id, vm_ref, id
        ),
        Some(&job_id),
        None,
    )
    .await
    .ok();

    Ok((StatusCode::ACCEPTED, Json(job)))
}

fn vm_to_response(vm: &VmInfo, hypervisor_id: &str) -> VmResponse {
    let disk_gb = vm
        .disks
        .iter()
        .map(|d| d.capacity_bytes.max(0) as u64 / (1024 * 1024 * 1024))
        .sum::<u64>() as i64;
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
    let disk_gb = vm
        .disks
        .iter()
        .map(|d| d.capacity_bytes.max(0) as u64 / (1024 * 1024 * 1024))
        .sum::<u64>() as i64;
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
                            ram_mb = ?5, disk_gb = ?6, updated_at = ?7 WHERE id = ?8",
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
                            ram_mb = $5, disk_gb = $6, updated_at = $7 WHERE id = $8",
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
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unprotected', ?10, ?10)",
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
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unprotected', $10, $10)",
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
    crate::db::hypervisor::fetch_hypervisors(db).await
}

pub async fn fetch_hypervisor(db: &DbPool, id: &str) -> Result<Option<HypervisorModel>> {
    crate::db::hypervisor::fetch_hypervisor(db, id).await
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
    use crate::auth::jwt::Claims;
    use crate::db::models::hypervisor::HypervisorModel;
    use crate::server::routes::testutil::{read_json, test_state};
    use axum::body::Body;
    use axum::http::{Request, StatusCode as HttpStatus};
    use tower::ServiceExt;

    fn admin_claims() -> Claims {
        Claims {
            sub: "test-admin".into(),
            username: "admin".into(),
            role: "admin".into(),
            exp: usize::MAX,
            iat: 0,
            tenant_id: None,
        }
    }

    fn with_claims<B: axum::body::HttpBody + Send + 'static>(
        mut req: Request<B>,
        claims: &Claims,
    ) -> Request<B> {
        req.extensions_mut().insert(claims.clone());
        req
    }

    #[tokio::test]
    async fn hypervisor_crud_roundtrip() {
        let dir = std::env::temp_dir().join(format!("bck-hv-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let state = test_state(db_path.to_str().unwrap()).await;

        let app = router().with_state(state.clone());
        let claims = admin_claims();

        // Unsupported hypervisor type is rejected before connecting.
        let add = with_claims(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"lab","hv_type":"nonsense","host":"h","port":5985,"username":"u","password":"p"}"#,
                ))
                .unwrap(),
            &claims,
        );
        let resp = app.clone().oneshot(add).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::BAD_REQUEST);

        // Hyper-V hypervisor — connection test fails (no such host), but the
        // record is still stored with status "error".
        let add = with_claims(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"lab","hv_type":"hyperv","host":"hv.local","port":5985,"username":"u","password":"p"}"#,
                ))
                .unwrap(),
            &claims,
        );
        let resp = app.clone().oneshot(add).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::CREATED);
        let created: HypervisorResponse = read_json(resp).await;
        assert_eq!(created.status, "error");
        assert_eq!(created.hv_type, "hyperv");

        // List returns the record.
        let resp = app
            .clone()
            .oneshot(with_claims(
                Request::builder()
                    .method("GET")
                    .uri("/")
                    .body(Body::empty())
                    .unwrap(),
                &claims,
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), HttpStatus::OK);
        let list: Vec<HypervisorResponse> = read_json(resp).await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, created.id);

        // Get single.
        let resp = app
            .clone()
            .oneshot(with_claims(
                Request::builder()
                    .method("GET")
                    .uri(format!("/{}", created.id))
                    .body(Body::empty())
                    .unwrap(),
                &claims,
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), HttpStatus::OK);

        // Delete.
        let resp = app
            .clone()
            .oneshot(with_claims(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/{}", created.id))
                    .body(Body::empty())
                    .unwrap(),
                &claims,
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), HttpStatus::NO_CONTENT);

        // Get after delete -> 404.
        let resp = app
            .clone()
            .oneshot(with_claims(
                Request::builder()
                    .method("GET")
                    .uri(format!("/{}", created.id))
                    .body(Body::empty())
                    .unwrap(),
                &claims,
            ))
            .await
            .unwrap();
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
        let claims = admin_claims();

        let resp = app
            .oneshot(with_claims(
                Request::builder()
                    .method("POST")
                    .uri("/missing/test")
                    .body(Body::empty())
                    .unwrap(),
                &claims,
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), HttpStatus::NOT_FOUND);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn vm_backup_job_start_and_list() {
        let dir = std::env::temp_dir().join(format!("bck-hv-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let state = test_state(db_path.to_str().unwrap()).await;

        let app = router().with_state(state.clone());
        let claims = admin_claims();

        // Create a hypervisor record (connection fails — no such host — but the
        // row is stored with status "error", which is enough to start a job).
        let add = with_claims(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"name":"lab","hv_type":"hyperv","host":"hv.local","port":5985,"username":"u","password":"p"}"#,
                ))
                .unwrap(),
            &claims,
        );
        let resp = app.clone().oneshot(add).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::CREATED);
        let hv: HypervisorResponse = read_json(resp).await;

        // Create a repository row so the job FK resolves.
        let t = chrono::Utc::now().timestamp();
        sqlx::query(
            "INSERT INTO repositories (id, name, repo_type, config_json, capacity_bytes, used_bytes,
             free_bytes, encrypted, immutable, status, created_at, updated_at)
             VALUES ('repo-1', 'main', 'local', ?, 0, 0, 0, 0, 0, 'ready', ?, ?)",
        )
        .bind(serde_json::json!({"path": dir.join("store")}).to_string())
        .bind(t)
        .bind(t)
        .execute(&match &state.db {
            crate::db::DbPool::Sqlite(p) => p.clone(),
            _ => unreachable!(),
        })
        .await
        .unwrap();

        // Start a VM backup job -> 202 Accepted with the job view.
        let backup = with_claims(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/vms/vm-42/backup", hv.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"repository_id":"repo-1","vm_name":"test-vm","name":"nightly-vm"}"#,
                ))
                .unwrap(),
            &claims,
        );
        let resp = app.clone().oneshot(backup).await.unwrap();
        assert_eq!(resp.status(), HttpStatus::ACCEPTED);
        let job: serde_json::Value = read_json(resp).await;
        assert_eq!(job["job_type"], "vm");
        assert_eq!(job["name"], "nightly-vm");
        assert_eq!(job["repository_id"], "repo-1");
        let job_id = job["id"].as_str().unwrap().to_string();

        // The job should now be listed.
        let jm = state.job_manager.lock().await;
        let jobs = jm.list_jobs().await.unwrap();
        drop(jm);
        assert!(jobs.iter().any(|j| j.id == job_id && j.job_type == "vm"));

        // Backup on a missing hypervisor -> 404.
        let resp = app
            .oneshot(with_claims(
                Request::builder()
                    .method("POST")
                    .uri("/missing/vms/vm-42/backup")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"repository_id":"repo-1"}"#))
                    .unwrap(),
                &claims,
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), HttpStatus::NOT_FOUND);

        std::fs::remove_dir_all(&dir).ok();
    }

    // Tenant isolation: a user whose claims.tenant_id is "t1" must not see
    // a hypervisor owned by tenant "t2". SEC-004 regression test.
    #[test]
    fn tenant_filter_isolates_hypervisors() {
        use crate::auth::policy::tenant_allows as ta;
        let c_t1 = Claims {
            sub: "u".into(),
            username: "u".into(),
            role: "operator".into(),
            exp: 0,
            iat: 0,
            tenant_id: Some("t1".into()),
        };
        let c_super = Claims {
            sub: "u".into(),
            username: "u".into(),
            role: "super_admin".into(),
            exp: 0,
            iat: 0,
            tenant_id: None,
        };
        assert!(ta(&c_t1, Some("t1")));
        assert!(!ta(&c_t1, Some("t2")));
        assert!(!ta(&c_t1, None));
        assert!(ta(&c_super, Some("t1")));
        assert!(ta(&c_super, None));
    }

    // Compile-time check that HypervisorModel fields are referenced.
    #[allow(dead_code)]
    fn _check_hv_model(_h: HypervisorModel) {
        let _ = _h.tenant_id;
    }
}
