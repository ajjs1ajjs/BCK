use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::{info, warn};

pub mod bck_proto {
    include!(concat!(env!("OUT_DIR"), "/bck.rs"));
}

use bck_proto::backup_engine_server::BackupEngine;
use bck_proto::{
    Empty, JobConfig, JobHandle, ProgressReport, SnapshotQuery, SnapshotList,
    ValidationResult, RestoreConfig, RestoreProgress, FileRestoreRequest,
    InstantRecoveryConfig, EngineStats, HealthStatus, RepositoryRef, RepositoryStats,
    ComponentHealth,
};

use bck_proto::sobr_service_server::SobrService;
use bck_proto::cloud_service_server::CloudService;
use bck_proto::m365_service_server::M365Service;
use bck_proto::agent_server::Agent;
use bck_proto::{
    AccountRef, CloudAccount as PbCloudAccount, CloudAccountList as PbCloudAccountList,
    CloudRestore as PbCloudRestore, CloudRestoreList as PbCloudRestoreList,
    M365BackupJob as PbM365BackupJob, M365BackupJobList as PbM365BackupJobList,
    M365StartRequest, M365Tenant as PbM365Tenant, M365TenantList as PbM365TenantList,
    RestorableKind as PbRestorableKind, RestorableKindList as PbRestorableKindList,
    RestoreQuery, RestoreRequest as PbRestoreRequest, SobrPolicy as PbSobrPolicy,
    SobrPolicyList as PbSobrPolicyList, SobrTier as PbSobrTier, SobrTierList as PbSobrTierList,
    AgentBackupConfig, AgentRestoreConfig, AgentStatus as PbAgentStatus,
    HeartbeatRequest as PbHeartbeatRequest, HeartbeatResponse as PbHeartbeatResponse,
    ScriptRequest as PbScriptRequest, ScriptResult as PbScriptResult,
    UpdateProgress, UpdateRequest as PbUpdateRequest,
};

use crate::server::AppState;

// ---------------------------------------------------------------------------
// BackupEngine (core engine operations, backed by the real JobManager + DB)
// ---------------------------------------------------------------------------

pub struct BackupEngineImpl {
    state: Arc<AppState>,
}

impl BackupEngineImpl {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }
}

#[tonic::async_trait]
impl BackupEngine for BackupEngineImpl {
    async fn start_job(
        &self,
        request: Request<JobConfig>,
    ) -> Result<Response<JobHandle>, Status> {
        let config = request.into_inner();
        info!("gRPC start_job: {}", config.name);

        let job_type = if config.job_type.is_empty() { "file".to_string() } else { config.job_type.clone() };
        let backup_type = if config.backup_type.is_empty() { "full".to_string() } else { config.backup_type.clone() };

        let jm = self.state.job_manager.lock().await;
        let job_id = if job_type == "vm" {
            let hypervisor_id = config.source.as_ref()
                .and_then(|s| if s.hypervisor_id.is_empty() { None } else { Some(s.hypervisor_id.clone()) })
                .ok_or_else(|| Status::invalid_argument("vm job requires source.hypervisor_id"))?;
            let vm_ref = config.source.as_ref()
                .and_then(|s| s.vm_ids.first().cloned())
                .ok_or_else(|| Status::invalid_argument("vm job requires source.vm_ids"))?;
            jm.register_vm_job(
                &config.name,
                Some(&config.description),
                &hypervisor_id,
                &vm_ref,
                None,
                &config.destination.as_ref().map(|d| d.repository_id.clone()).unwrap_or_default(),
                None,
                retention_days(&config),
            ).await.map_err(status_err)?
        } else {
            let source_path = config.source.as_ref()
                .and_then(|s| s.paths.first().cloned())
                .unwrap_or_default();
            jm.register_job(
                &config.name,
                Some(&config.description),
                &job_type,
                &backup_type,
                &source_path,
                &config.destination.as_ref().map(|d| d.repository_id.clone()).unwrap_or_default(),
                None,
                retention_days(&config),
            ).await.map_err(status_err)?
        };

        jm.start_job(&job_id).await.map_err(status_err)?;
        drop(jm);

        Ok(Response::new(JobHandle {
            job_id: job_id.clone(),
            session_id: String::new(),
            status: "running".into(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }))
    }

    async fn cancel_job(
        &self,
        request: Request<JobHandle>,
    ) -> Result<Response<Empty>, Status> {
        let handle = request.into_inner();
        info!("gRPC cancel_job: {}", handle.job_id);
        let jm = self.state.job_manager.lock().await;
        jm.cancel_job(&handle.job_id).await.map_err(status_err)?;
        Ok(Response::new(Empty {}))
    }

    type StreamProgressStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<ProgressReport, Status>> + Send>>;

    async fn stream_progress(
        &self,
        request: Request<JobHandle>,
    ) -> Result<Response<Self::StreamProgressStream>, Status> {
        let handle = request.into_inner();
        let (tx, rx) = mpsc::channel(100);
        let state = self.state.clone();

        tokio::spawn(async move {
            for _ in 0..600 {
                let job = {
                    let jm = state.job_manager.lock().await;
                    jm.get_job(&handle.job_id).await.ok().flatten()
                };
                match job {
                    Some(job) => {
                        let report = ProgressReport {
                            job_id: job.id.clone(),
                            progress_pct: job.progress,
                            processed_bytes: job.stats.as_ref().map(|s| s.transferred_bytes).unwrap_or(0),
                            total_bytes: job.stats.as_ref().map(|s| s.total_bytes).unwrap_or(0),
                            transferred_bytes: job.stats.as_ref().map(|s| s.transferred_bytes).unwrap_or(0),
                            files_processed: job.stats.as_ref().map(|s| s.files_processed).unwrap_or(0),
                            status: job.status.clone(),
                            phase: if job.status == "completed" { "completed".into() } else { "running".into() },
                            ..Default::default()
                        };
                        let done = job.status == "completed" || job.status.starts_with("failed");
                        if tx.send(Ok(report)).await.is_err() {
                            break;
                        }
                        if done {
                            break;
                        }
                    }
                    None => {
                        let _ = tx.send(Err(Status::not_found("job not found"))).await;
                        break;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    async fn list_snapshots(
        &self,
        request: Request<SnapshotQuery>,
    ) -> Result<Response<SnapshotList>, Status> {
        let query = request.into_inner();
        let snapshots = crate::server::routes::snapshots::fetch_snapshots(
            &self.state.db,
            if query.job_id.is_empty() { None } else { Some(query.job_id.as_str()) },
            if query.limit > 0 { query.limit as i64 } else { 100 },
        ).await.map_err(status_err)?;

        let list: Vec<bck_proto::Snapshot> = snapshots.into_iter().map(|s| bck_proto::Snapshot {
            id: s.id,
            job_id: s.job_id,
            repository_id: s.repository_id,
            snapshot_type: s.snapshot_type,
            parent_id: s.parent_id.unwrap_or_default(),
            size_bytes: s.size_bytes.max(0) as u64,
            unique_bytes: s.unique_bytes.max(0) as u64,
            compressed_bytes: s.compressed_bytes.max(0) as u64,
            checksum: s.checksum,
            consistency: s.consistency,
            app_consistent: s.app_consistent,
            created_at: s.created_at.to_string(),
            ..Default::default()
        }).collect();

        let total = list.len() as i32;
        Ok(Response::new(SnapshotList { snapshots: list, total }))
    }

    async fn validate_config(
        &self,
        request: Request<JobConfig>,
    ) -> Result<Response<ValidationResult>, Status> {
        let config = request.into_inner();
        let mut errors = Vec::new();
        if config.name.is_empty() {
            errors.push(bck_proto::ValidationError {
                field: "name".into(),
                message: "job name is required".into(),
                code: "missing_name".into(),
            });
        }
        if config.destination.is_none() || config.destination.as_ref().unwrap().repository_id.is_empty() {
            errors.push(bck_proto::ValidationError {
                field: "destination.repository_id".into(),
                message: "repository is required".into(),
                code: "missing_repository".into(),
            });
        }
        Ok(Response::new(ValidationResult {
            valid: errors.is_empty(),
            errors,
            warnings: vec![],
        }))
    }

    type RestoreStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<RestoreProgress, Status>> + Send>>;

    async fn restore(
        &self,
        request: Request<RestoreConfig>,
    ) -> Result<Response<Self::RestoreStream>, Status> {
        let cfg = request.into_inner();
        let (tx, rx) = mpsc::channel(100);
        let state = self.state.clone();
        let snapshot_id = cfg.snapshot_id.clone();
        let target = cfg.destination.map(|d| d.path).unwrap_or_default();
        let power_on = cfg.options.as_ref().map(|o| o.power_on).unwrap_or(false);
        let datastore = cfg.options.as_ref().map(|o| o.target_datastore.clone()).unwrap_or_default();

        tokio::spawn(async move {
            let session = {
                let restore = crate::restore::RestoreOrchestrator::new(
                    &state.config.storage.default_path.to_string_lossy(),
                );
                match restore {
                    Ok(r) => {
                        // Resolve the repository from the snapshot.
                        let snapshot = crate::server::routes::snapshots::fetch_snapshot(&state.db, &snapshot_id)
                            .await.ok().flatten();
                        let repo = match &snapshot {
                            Some(s) => crate::server::routes::repositories::fetch_repository(&state.db, &s.repository_id)
                                .await.ok().flatten(),
                            None => None,
                        };
                        let storage = match repo {
                            Some(r) => build_storage_from_repo(&r).await,
                            None => None,
                        };
                        match storage {
                            Some(storage) => {
                                r.restore_vm(
                                    &snapshot_id,
                                    &if datastore.is_empty() { target.clone() } else { datastore },
                                    storage.as_ref(),
                                    None,
                                    None,
                                    &format!("bck-restore-{}", &snapshot_id[..snapshot_id.len().min(12)]),
                                    power_on,
                                ).await.ok()
                            }
                            None => None,
                        }
                    }
                    Err(_) => None,
                }
            };
            let (restored_bytes, total_bytes, ok) = match session {
                Some(s) => (s.bytes_processed, s.total_bytes, true),
                None => (0, 0, false),
            };
            let _ = tx.send(Ok(RestoreProgress {
                job_id: String::new(),
                progress_pct: 100.0,
                restored_bytes,
                total_bytes,
                status: if ok { "completed".into() } else { "failed".into() },
                ..Default::default()
            })).await;
        });
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    type RestoreFileStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<RestoreProgress, Status>> + Send>>;

    async fn restore_file(
        &self,
        request: Request<FileRestoreRequest>,
    ) -> Result<Response<Self::RestoreFileStream>, Status> {
        let req = request.into_inner();
        let (tx, rx) = mpsc::channel(100);
        let state = self.state.clone();

        tokio::spawn(async move {
            let restored = {
                let restore = crate::restore::RestoreOrchestrator::new(
                    &state.config.storage.default_path.to_string_lossy(),
                );
                match restore {
                    Ok(r) => {
                        let snapshot = crate::server::routes::snapshots::fetch_snapshot(&state.db, &req.snapshot_id)
                            .await.ok().flatten();
                        let repo = match &snapshot {
                            Some(s) => crate::server::routes::repositories::fetch_repository(&state.db, &s.repository_id)
                                .await.ok().flatten(),
                            None => None,
                        };
                        let storage = match repo {
                            Some(r) => build_storage_from_repo(&r).await,
                            None => None,
                        };
                        match storage {
                            Some(storage) => {
                                r.restore_file(
                                    &req.snapshot_id,
                                    &req.files,
                                    &req.target_path,
                                    storage.as_ref(),
                                    None,
                                    req.options.as_ref().map(|o| o.overwrite).unwrap_or(false),
                                ).await.ok()
                            }
                            None => None,
                        }
                    }
                    Err(_) => None,
                }
            };
            let (restored_bytes, total_bytes, ok) = match restored {
                Some(s) => (s.bytes_processed, s.total_bytes, true),
                None => (0, 0, false),
            };
            let _ = tx.send(Ok(RestoreProgress {
                restored_bytes,
                total_bytes,
                status: if ok { "completed".into() } else { "failed".into() },
                ..Default::default()
            })).await;
        });
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    type InstantRecoveryStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<RestoreProgress, Status>> + Send>>;

    async fn instant_recovery(
        &self,
        request: Request<InstantRecoveryConfig>,
    ) -> Result<Response<Self::InstantRecoveryStream>, Status> {
        let cfg = request.into_inner();
        let (tx, rx) = mpsc::channel(100);
        let state = self.state.clone();

        tokio::spawn(async move {
            let snapshot = crate::server::routes::snapshots::fetch_snapshot(&state.db, &cfg.snapshot_id)
                .await.ok().flatten();
            let repo = match &snapshot {
                Some(s) => crate::server::routes::repositories::fetch_repository(&state.db, &s.repository_id)
                    .await.ok().flatten(),
                None => None,
            };
            let storage = match repo {
                Some(r) => build_storage_from_repo(&r).await,
                None => None,
            };
            let session = match storage {
                Some(storage) => state.instant_recovery.start_nfs(
                    &state.config.storage.default_path.to_string_lossy(),
                    storage,
                    &cfg.snapshot_id,
                    &if cfg.vm_name.is_empty() { "instant".into() } else { cfg.vm_name.clone() },
                    "",
                    "",
                ).await.ok(),
                None => None,
            };
            let _ = tx.send(Ok(RestoreProgress {
                progress_pct: 100.0,
                status: if session.is_some() { "running".into() } else { "failed".into() },
                target_info: session.map(|s| s.mount_path).unwrap_or_default(),
                ..Default::default()
            })).await;
        });
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    async fn get_stats(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<EngineStats>, Status> {
        let index = crate::index::BlockIndex::new(
            &self.state.config.storage.default_path.to_string_lossy(),
        ).map_err(status_err)?;
        let (total_refs, unique, total_size) = index.dedup_stats().unwrap_or((0, 0, 0));

        let jobs = {
            let jm = self.state.job_manager.lock().await;
            jm.list_jobs().await.unwrap_or_default()
        };
        let running = jobs.iter().filter(|j| j.status == "running").count() as u32;

        Ok(Response::new(EngineStats {
            total_blocks: total_refs,
            unique_blocks: unique,
            total_bytes: total_size,
            unique_bytes: 0,
            compressed_bytes: 0,
            active_jobs: running,
            uptime_seconds: 0,
            ..Default::default()
        }))
    }

    async fn check_health(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<HealthStatus>, Status> {
        let mut components = Vec::new();
        let db_ok = match &self.state.db {
            crate::db::DbPool::Sqlite(pool) => sqlx::query("SELECT 1").fetch_one(pool).await.is_ok(),
            crate::db::DbPool::Postgres(pool) => sqlx::query("SELECT 1").fetch_one(pool).await.is_ok(),
        };
        components.push(ComponentHealth {
            name: "database".into(),
            status: if db_ok { "ok".into() } else { "degraded".into() },
            message: String::new(),
            last_check: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        });

        Ok(Response::new(HealthStatus {
            status: if db_ok { "healthy".into() } else { "degraded".into() },
            version: env!("CARGO_PKG_VERSION").into(),
            uptime: 0,
            components,
        }))
    }

    async fn get_repository_stats(
        &self,
        request: Request<RepositoryRef>,
    ) -> Result<Response<RepositoryStats>, Status> {
        let repo_ref = request.into_inner();
        let repo = crate::server::routes::repositories::fetch_repository(&self.state.db, &repo_ref.repository_id)
            .await.map_err(status_err)?
            .ok_or_else(|| Status::not_found("repository not found"))?;

        let index = crate::index::BlockIndex::new(
            &self.state.config.storage.default_path.to_string_lossy(),
        ).map_err(status_err)?;
        let (total_refs, unique, _) = index.dedup_stats().unwrap_or((0, 0, 0));

        Ok(Response::new(RepositoryStats {
            repository_id: repo.id,
            name: repo.name,
            r#type: repo.repo_type,
            capacity_bytes: repo.capacity_bytes.max(0) as u64,
            used_bytes: repo.used_bytes.max(0) as u64,
            free_bytes: repo.free_bytes.max(0) as u64,
            total_blocks: total_refs,
            unique_blocks: unique,
            status: repo.status,
            ..Default::default()
        }))
    }
}

// ---------------------------------------------------------------------------
// SOBR service
// ---------------------------------------------------------------------------

pub struct SobrServiceService {
    state: Arc<AppState>,
}

impl SobrServiceService {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }
}

fn tier_type_str(t: &crate::sobr::TierType) -> &'static str {
    match t {
        crate::sobr::TierType::Performance => "performance",
        crate::sobr::TierType::Capacity => "capacity",
        crate::sobr::TierType::Archive => "archive",
    }
}

fn tier_status_str(s: &crate::sobr::TierStatus) -> &'static str {
    match s {
        crate::sobr::TierStatus::Online => "online",
        crate::sobr::TierStatus::Offline => "offline",
        crate::sobr::TierStatus::Full => "full",
        crate::sobr::TierStatus::Degraded => "degraded",
    }
}

fn parse_tier_type(s: &str) -> crate::sobr::TierType {
    match s.to_lowercase().as_str() {
        "performance" => crate::sobr::TierType::Performance,
        "archive" => crate::sobr::TierType::Archive,
        _ => crate::sobr::TierType::Capacity,
    }
}

#[tonic::async_trait]
impl SobrService for SobrServiceService {
    async fn list_tiers(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<PbSobrTierList>, Status> {
        let tiers = self.state.sobr.get_tier_stats().await;
        Ok(Response::new(PbSobrTierList {
            tiers: tiers.into_iter().map(tier_to_pb).collect(),
        }))
    }

    async fn add_tier(
        &self,
        request: Request<PbSobrTier>,
    ) -> Result<Response<PbSobrTier>, Status> {
        let pb = request.into_inner();
        let tier = crate::sobr::StorageTier {
            id: String::new(),
            name: pb.name,
            tier_type: parse_tier_type(&pb.tier_type),
            backend: pb.backend,
            backend_config: serde_json::json!({}),
            capacity_bytes: pb.capacity_bytes,
            used_bytes: pb.used_bytes,
            status: crate::sobr::TierStatus::Online,
            priority: pb.priority,
        };
        let created = self.state.sobr.add_tier(tier).await.map_err(status_err)?;
        Ok(Response::new(tier_to_pb(created)))
    }

    async fn list_policies(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<PbSobrPolicyList>, Status> {
        let policies = self.state.sobr.list_policies().await;
        Ok(Response::new(PbSobrPolicyList {
            policies: policies.into_iter().map(policy_to_pb).collect(),
        }))
    }

    async fn create_policy(
        &self,
        request: Request<PbSobrPolicy>,
    ) -> Result<Response<PbSobrPolicy>, Status> {
        let pb = request.into_inner();
        let policy = crate::sobr::SobrPolicy {
            id: String::new(),
            name: pb.name,
            performance_tier_id: pb.performance_tier_id,
            capacity_tier_id: pb.capacity_tier_id,
            archive_tier_id: if pb.archive_tier_id.is_empty() { None } else { Some(pb.archive_tier_id) },
            capacity_move_days: pb.capacity_move_days,
            archive_move_days: if pb.archive_move_days > 0 { Some(pb.archive_move_days) } else { None },
            seal_days: if pb.seal_days > 0 { Some(pb.seal_days) } else { None },
            retention_days: if pb.retention_days > 0 { Some(pb.retention_days) } else { None },
        };
        let created = self.state.sobr.create_policy(policy).await.map_err(status_err)?;
        Ok(Response::new(policy_to_pb(created)))
    }

    async fn get_tier_stats(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<PbSobrTierList>, Status> {
        let tiers = self.state.sobr.get_tier_stats().await;
        Ok(Response::new(PbSobrTierList {
            tiers: tiers.into_iter().map(tier_to_pb).collect(),
        }))
    }
}

// ---------------------------------------------------------------------------
// Cloud service
// ---------------------------------------------------------------------------

pub struct CloudServiceService {
    state: Arc<AppState>,
}

impl CloudServiceService {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }
}

fn provider_str(p: &crate::cloud::CloudProvider) -> &'static str {
    match p {
        crate::cloud::CloudProvider::Aws => "aws",
        crate::cloud::CloudProvider::Azure => "azure",
        crate::cloud::CloudProvider::Gcp => "gcp",
    }
}

fn parse_provider(s: &str) -> Result<crate::cloud::CloudProvider, Status> {
    match s.to_lowercase().as_str() {
        "aws" => Ok(crate::cloud::CloudProvider::Aws),
        "azure" => Ok(crate::cloud::CloudProvider::Azure),
        "gcp" | "google" => Ok(crate::cloud::CloudProvider::Gcp),
        other => Err(Status::invalid_argument(format!("unknown cloud provider: {}", other))),
    }
}

fn account_status_str(s: &crate::cloud::AccountStatus) -> String {
    match s {
        crate::cloud::AccountStatus::Connected => "connected".into(),
        crate::cloud::AccountStatus::Disconnected => "disconnected".into(),
        crate::cloud::AccountStatus::AuthExpired => "auth_expired".into(),
        crate::cloud::AccountStatus::Error(e) => format!("error: {}", e),
    }
}

fn account_to_pb(a: &crate::cloud::CloudAccount) -> PbCloudAccount {
    PbCloudAccount {
        id: a.id.clone(),
        name: a.name.clone(),
        provider: provider_str(&a.provider).into(),
        auth_type: a.auth_type.clone(),
        region: a.region.clone(),
        status: account_status_str(&a.status),
    }
}

fn restore_status_str(s: &crate::cloud::restore::CloudRestoreStatus) -> String {
    format!("{:?}", s)
}

fn restore_to_pb(r: &crate::cloud::restore::CloudRestore) -> PbCloudRestore {
    PbCloudRestore {
        id: r.id.clone(),
        account_id: r.account_id.clone(),
        resource_type: r.resource_type.clone(),
        resource_id: r.resource_id.clone(),
        target_name: r.target_name.clone(),
        status: restore_status_str(&r.status),
        requested_at: r.requested_at,
        completed_at: r.completed_at.unwrap_or(0),
        result: r.result.clone().unwrap_or_default(),
        error: r.error.clone().unwrap_or_default(),
    }
}

#[tonic::async_trait]
impl CloudService for CloudServiceService {
    async fn list_accounts(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<PbCloudAccountList>, Status> {
        let accounts = self.state.cloud.list_accounts().await;
        Ok(Response::new(PbCloudAccountList {
            accounts: accounts.iter().map(account_to_pb).collect(),
        }))
    }

    async fn register_account(
        &self,
        request: Request<PbCloudAccount>,
    ) -> Result<Response<PbCloudAccount>, Status> {
        let pb = request.into_inner();
        let provider = parse_provider(&pb.provider)?;
        let account = crate::cloud::CloudAccount {
            id: String::new(),
            name: pb.name,
            provider,
            auth_type: pb.auth_type,
            region: pb.region,
            status: crate::cloud::AccountStatus::Connected,
            access_key: None,
            secret_key: None,
            session_token: None,
            tenant_id: None,
            client_id: None,
            client_secret: None,
            project_id: None,
        };
        let created = self.state.cloud.register_account(account).await.map_err(status_err)?;
        Ok(Response::new(account_to_pb(&created)))
    }

    async fn remove_account(
        &self,
        request: Request<AccountRef>,
    ) -> Result<Response<Empty>, Status> {
        let removed = self.state.cloud.remove_account(&request.into_inner().id).await;
        if !removed {
            return Err(Status::not_found("account not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn get_account(
        &self,
        request: Request<AccountRef>,
    ) -> Result<Response<PbCloudAccount>, Status> {
        let account = self.state.cloud.get_account(&request.into_inner().id).await
            .ok_or_else(|| Status::not_found("account not found"))?;
        Ok(Response::new(account_to_pb(&account)))
    }

    async fn list_restorable_kinds(
        &self,
        request: Request<AccountRef>,
    ) -> Result<Response<PbRestorableKindList>, Status> {
        let account = self.state.cloud.get_account(&request.into_inner().id).await
            .ok_or_else(|| Status::not_found("account not found"))?;
        let kinds = crate::cloud::restore::restorable_kinds(&account.provider);
        Ok(Response::new(PbRestorableKindList {
            kinds: kinds.into_iter().map(|k| PbRestorableKind {
                resource_type: k.resource_type,
                label: k.label,
            }).collect(),
        }))
    }

    async fn submit_restore(
        &self,
        request: Request<PbRestoreRequest>,
    ) -> Result<Response<PbCloudRestore>, Status> {
        let pb = request.into_inner();
        let account = self.state.cloud.get_account(&pb.account_id).await
            .ok_or_else(|| Status::not_found("account not found"))?;
        let req = crate::cloud::restore::RestoreRequest {
            resource_type: pb.resource_type,
            resource_id: pb.resource_id,
            target_name: pb.target_name,
            params: pb.params,
        };
        let restore = self.state.cloud_restore.submit(&account, req).await.map_err(status_err)?;
        Ok(Response::new(restore_to_pb(&restore)))
    }

    async fn list_restores(
        &self,
        request: Request<RestoreQuery>,
    ) -> Result<Response<PbCloudRestoreList>, Status> {
        let q = request.into_inner();
        let restores = if q.account_id.is_empty() {
            self.state.cloud_restore.list().await
        } else {
            self.state.cloud_restore.list_for_account(&q.account_id).await
        };
        Ok(Response::new(PbCloudRestoreList {
            restores: restores.iter().map(restore_to_pb).collect(),
        }))
    }
}

// ---------------------------------------------------------------------------
// M365 service
// ---------------------------------------------------------------------------

pub struct M365ServiceService {
    state: Arc<AppState>,
}

impl M365ServiceService {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }
}

fn m365_auth_str(a: &crate::m365::AuthType) -> &'static str {
    match a {
        crate::m365::AuthType::AppOnly => "app_only",
        crate::m365::AuthType::Delegated => "delegated",
    }
}

fn m365_status_str(s: &crate::m365::TenantStatus) -> String {
    match s {
        crate::m365::TenantStatus::Connected => "connected".into(),
        crate::m365::TenantStatus::Disconnected => "disconnected".into(),
        crate::m365::TenantStatus::AuthExpired => "auth_expired".into(),
        crate::m365::TenantStatus::Error(e) => format!("error: {}", e),
    }
}

fn m365_bt_str(b: &crate::m365::M365BackupType) -> &'static str {
    match b {
        crate::m365::M365BackupType::Mailbox => "mailbox",
        crate::m365::M365BackupType::OneDrive => "onedrive",
        crate::m365::M365BackupType::SharePoint => "sharepoint",
        crate::m365::M365BackupType::All => "all",
    }
}

fn parse_m365_bt(s: &str) -> Result<crate::m365::M365BackupType, Status> {
    match s.to_lowercase().as_str() {
        "mailbox" => Ok(crate::m365::M365BackupType::Mailbox),
        "onedrive" => Ok(crate::m365::M365BackupType::OneDrive),
        "sharepoint" => Ok(crate::m365::M365BackupType::SharePoint),
        "all" | "" => Ok(crate::m365::M365BackupType::All),
        other => Err(Status::invalid_argument(format!("unknown m365 backup type: {}", other))),
    }
}

fn tenant_to_pb(t: &crate::m365::M365Tenant) -> PbM365Tenant {
    PbM365Tenant {
        id: t.id.clone(),
        tenant_id: t.tenant_id.clone(),
        name: t.name.clone(),
        auth_type: m365_auth_str(&t.auth_type).into(),
        status: m365_status_str(&t.status),
    }
}

fn job_to_pb(j: &crate::m365::M365BackupJob) -> PbM365BackupJob {
    PbM365BackupJob {
        id: j.id.clone(),
        tenant_id: j.tenant_id.clone(),
        backup_type: m365_bt_str(&j.backup_type).into(),
        status: j.status.clone(),
        items_processed: j.items_processed,
        bytes_processed: j.bytes_processed,
        started_at: j.started_at,
        completed_at: j.completed_at.unwrap_or(0),
    }
}

#[tonic::async_trait]
impl M365Service for M365ServiceService {
    async fn list_tenants(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<PbM365TenantList>, Status> {
        let tenants = self.state.m365.list_tenants().await;
        Ok(Response::new(PbM365TenantList {
            tenants: tenants.iter().map(tenant_to_pb).collect(),
        }))
    }

    async fn register_tenant(
        &self,
        request: Request<PbM365Tenant>,
    ) -> Result<Response<PbM365Tenant>, Status> {
        let pb = request.into_inner();
        let tenant = crate::m365::M365Tenant {
            id: String::new(),
            tenant_id: pb.tenant_id,
            name: pb.name,
            auth_type: match pb.auth_type.to_lowercase().as_str() {
                "delegated" => crate::m365::AuthType::Delegated,
                _ => crate::m365::AuthType::AppOnly,
            },
            client_id: String::new(),
            encrypted_secret: String::new(),
            status: crate::m365::TenantStatus::Connected,
        };
        let created = self.state.m365.register_tenant(tenant).await.map_err(status_err)?;
        Ok(Response::new(tenant_to_pb(&created)))
    }

    async fn list_backup_jobs(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<PbM365BackupJobList>, Status> {
        let jobs = self.state.m365.list_jobs().await;
        Ok(Response::new(PbM365BackupJobList {
            jobs: jobs.iter().map(job_to_pb).collect(),
        }))
    }

    async fn start_backup(
        &self,
        request: Request<M365StartRequest>,
    ) -> Result<Response<PbM365BackupJob>, Status> {
        let req = request.into_inner();
        let backup_type = parse_m365_bt(&req.backup_type)?;
        let job = self.state.m365.start_backup(&req.tenant_id, backup_type).await.map_err(status_err)?;
        Ok(Response::new(job_to_pb(&job)))
    }
}

// ---------------------------------------------------------------------------
// Agent service (server-side: persists heartbeats, queues tasks, reports state)
// ---------------------------------------------------------------------------

pub struct AgentService {
    state: Arc<AppState>,
}

impl AgentService {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }
}

async fn upsert_agent(state: &AppState, hb: &PbHeartbeatRequest) -> Result<String, Status> {
    // Only accept well-formed, non-empty agent ids so the table cannot be
    // spammed with arbitrary garbage rows by a token holder.
    if hb.agent_id.is_empty() || hb.agent_id.len() > 128 {
        return Err(Status::invalid_argument("agent_id must be 1..128 chars"));
    }
    if !hb.agent_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(Status::invalid_argument("agent_id has invalid characters"));
    }
    let id = hb.agent_id.clone();
    let now = chrono::Utc::now().timestamp();
    let capabilities = serde_json::to_string(&hb.capabilities)
        .unwrap_or_else(|_| "[]".into());
    let ip: Option<String> = None;

    let res: Result<(), String> = match &state.db {
        crate::db::DbPool::Sqlite(pool) => {
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
            .bind(&hb.hostname)
            .bind(&ip)
            .bind(&hb.os_type)
            .bind(&hb.os_version)
            .bind(&hb.agent_version)
            .bind(now)
            .bind(&capabilities)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
        crate::db::DbPool::Postgres(pool) => {
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
            .bind(&hb.hostname)
            .bind(&ip)
            .bind(&hb.os_type)
            .bind(&hb.os_version)
            .bind(&hb.agent_version)
            .bind(now)
            .bind(&capabilities)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
    };
    res.map_err(|e| Status::internal(e))?;
    Ok(id)
}

/// Insert a task into `agent_tasks` and return its id. Only allowlisted task
/// types may be queued — the server never dispatches arbitrary command
/// execution (run_script / update) through the task queue.
async fn insert_agent_task(state: &AppState, agent_id: &str, task_type: &str, payload: serde_json::Value) -> Result<String, Status> {
    const ALLOWED_TASK_TYPES: [&str; 4] = ["file_backup", "sql_backup", "discover", "heartbeat_ack"];
    if !ALLOWED_TASK_TYPES.contains(&task_type) {
        return Err(Status::invalid_argument(format!("unsupported task type: {task_type}")));
    }
    let task_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let payload = payload.to_string();

    let res: Result<(), String> = match &state.db {
        crate::db::DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO agent_tasks (id, agent_id, task_type, status, payload, created_at)
                 VALUES (?1, ?2, ?3, 'pending', ?4, ?5)"
            )
            .bind(&task_id)
            .bind(agent_id)
            .bind(task_type)
            .bind(&payload)
            .bind(now)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
        crate::db::DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO agent_tasks (id, agent_id, task_type, status, payload, created_at)
                 VALUES ($1, $2, $3, 'pending', $4, $5)"
            )
            .bind(&task_id)
            .bind(agent_id)
            .bind(task_type)
            .bind(&payload)
            .bind(now)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
    };
    res.map_err(|e| Status::internal(e))?;
    Ok(task_id)
}

#[tonic::async_trait]
impl Agent for AgentService {
    async fn heartbeat(
        &self,
        request: Request<PbHeartbeatRequest>,
    ) -> Result<Response<PbHeartbeatResponse>, Status> {
        let hb = request.into_inner();
        let id = upsert_agent(&self.state, &hb).await?;
        info!("gRPC agent heartbeat: {} ({})", hb.hostname, id);

        crate::db::record_event(
            &self.state.db,
            "agent_heartbeat",
            "agents",
            &format!("Agent {} heartbeat", id),
            None,
            None,
        ).await.ok();

        Ok(Response::new(PbHeartbeatResponse {
            accepted: true,
            server_time: chrono::Utc::now().to_rfc3339(),
            update_available: false,
            update_version: String::new(),
            update_url: String::new(),
            pending_commands: Vec::new(),
        }))
    }

    async fn start_backup(
        &self,
        request: Request<AgentBackupConfig>,
    ) -> Result<Response<JobHandle>, Status> {
        let cfg = request.into_inner();
        info!("gRPC agent start_backup: agent={} paths={:?}", cfg.agent_id, cfg.paths);

        let mut payload = serde_json::json!({
            "paths": cfg.paths,
            "use_vss": cfg.use_vss,
            "use_journal": cfg.use_journal,
        });

        // Ship the encryption config to the agent so backups are encrypted at
        // the source instead of being stored as plaintext.
        let enc_alg = self.state.config.encryption.algorithm.to_lowercase();
        if enc_alg != "none" {
            let key_path = self.state.config.encryption.key_path.clone()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| crate::encrypt::default_key_path(&self.state.config));
            if let Ok(key) = crate::encrypt::load_key(
                &key_path,
                self.state.config.encryption.passphrase.as_deref(),
            ) {
                use base64::Engine;
                payload["encryption"] = serde_json::json!(enc_alg);
                payload["encryption_key"] = serde_json::json!(
                    base64::engine::general_purpose::STANDARD.encode(&key)
                );
            } else {
                warn!("Failed to load encryption key for agent task; dispatching without encryption");
            }
        }

        let _task_id = insert_agent_task(&self.state, &cfg.agent_id, "file_backup", payload).await?;

        Ok(Response::new(JobHandle {
            job_id: cfg.agent_id.clone(),
            session_id: cfg.session_id,
            status: "queued".into(),
            created_at: chrono::Utc::now().timestamp() as u64,
        }))
    }

    type StartRestoreStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<RestoreProgress, Status>> + Send>>;

    async fn start_restore(
        &self,
        request: Request<AgentRestoreConfig>,
    ) -> Result<Response<Self::StartRestoreStream>, Status> {
        let cfg = request.into_inner();
        info!("gRPC agent start_restore: agent={} snapshot={}", cfg.agent_id, cfg.snapshot_id);

        let _ = insert_agent_task(&self.state, &cfg.agent_id, "file_restore", serde_json::json!({
            "snapshot_id": cfg.snapshot_id,
            "paths": cfg.paths,
            "target_path": cfg.target_path,
        })).await?;

        let (tx, rx) = mpsc::channel(8);
        tokio::spawn(async move {
            let _ = tx.send(Ok(RestoreProgress {
                status: "completed".into(),
                progress_pct: 100.0,
                ..Default::default()
            })).await;
        });
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    async fn execute_script(
        &self,
        request: Request<PbScriptRequest>,
    ) -> Result<Response<PbScriptResult>, Status> {
        let req = request.into_inner();
        // Remote script execution is disabled by default: the task queue must
        // never dispatch arbitrary command execution to protected machines.
        warn!(
            "gRPC execute_script rejected (disabled): agent={} interpreter={}",
            req.agent_id, req.interpreter
        );
        Err(Status::unimplemented("remote script execution is disabled"))
    }

    async fn get_status(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<PbAgentStatus>, Status> {
        let agents = crate::server::routes::agents::fetch_agents(&self.state.db)
            .await.map_err(status_err)?;
        match agents.first() {
            Some(a) => Ok(Response::new(PbAgentStatus {
                agent_id: a.id.clone(),
                hostname: a.hostname.clone(),
                status: a.status.clone(),
                version: a.agent_version.clone().unwrap_or_default(),
                running_jobs: Vec::new(),
                ..Default::default()
            })),
            None => Ok(Response::new(PbAgentStatus {
                status: "unknown".into(),
                ..Default::default()
            })),
        }
    }

    type UpdateAgentStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<UpdateProgress, Status>> + Send>>;

    async fn update_agent(
        &self,
        request: Request<PbUpdateRequest>,
    ) -> Result<Response<Self::UpdateAgentStream>, Status> {
        let req = request.into_inner();
        // Agent update dispatch is disabled: it would install an unsigned
        // package fetched from a caller-supplied URL (supply-chain risk).
        warn!(
            "gRPC update_agent rejected (disabled): agent={} target={}",
            req.agent_id, req.target_version
        );
        Err(Status::unimplemented("agent update dispatch is disabled"))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn status_err(e: anyhow::Error) -> Status {
    Status::internal(e.to_string())
}

fn retention_days(config: &JobConfig) -> Option<i32> {
    config.policy.as_ref().and_then(|p| {
        if p.daily > 0 { Some(p.daily) } else { None }
    })
}

fn tier_to_pb(t: crate::sobr::StorageTier) -> PbSobrTier {
    PbSobrTier {
        id: t.id,
        name: t.name,
        tier_type: tier_type_str(&t.tier_type).into(),
        backend: t.backend,
        capacity_bytes: t.capacity_bytes,
        used_bytes: t.used_bytes,
        status: tier_status_str(&t.status).into(),
        priority: t.priority,
    }
}

fn policy_to_pb(p: crate::sobr::SobrPolicy) -> PbSobrPolicy {
    PbSobrPolicy {
        id: p.id,
        name: p.name,
        performance_tier_id: p.performance_tier_id,
        capacity_tier_id: p.capacity_tier_id,
        archive_tier_id: p.archive_tier_id.unwrap_or_default(),
        capacity_move_days: p.capacity_move_days,
        archive_move_days: p.archive_move_days.unwrap_or(0),
        seal_days: p.seal_days.unwrap_or(0),
        retention_days: p.retention_days.unwrap_or(0),
    }
}

async fn build_storage_from_repo(
    repo: &crate::db::models::repository::RepositoryModel,
) -> Option<Box<dyn crate::storage::StorageBackend>> {
    let cfg: serde_json::Value = serde_json::from_str(&repo.config_json).unwrap_or_else(|_| serde_json::json!({}));
    let storage_config = crate::storage::StorageConfig {
        backend_type: repo.repo_type.clone(),
        path: cfg["path"].as_str().map(|s| s.to_string()),
        bucket: cfg["bucket"].as_str().map(|s| s.to_string()),
        region: cfg["region"].as_str().map(|s| s.to_string()),
        endpoint: cfg["endpoint"].as_str().map(|s| s.to_string()),
        access_key: cfg["access_key"].as_str().map(|s| s.to_string()),
        secret_key: cfg["secret_key"].as_str().map(|s| s.to_string()),
        container: cfg["container"].as_str().map(|s| s.to_string()),
        connection_string: cfg["connection_string"].as_str().map(|s| s.to_string()),
        account: cfg["account"].as_str().map(|s| s.to_string()),
    };
    crate::storage::create_backend(storage_config).await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_state() -> Arc<AppState> {
        let dir = std::env::temp_dir().join(format!("bck-grpc-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        crate::server::routes::testutil::test_state(
            &dir.join("test.db").to_string_lossy(),
        ).await
    }

    #[tokio::test]
    async fn engine_start_job_registers_and_starts() {
        let state = test_state().await;
        // Seed a repository so the FK resolves.
        let t = chrono::Utc::now().timestamp();
        match &state.db {
            crate::db::DbPool::Sqlite(pool) => {
                sqlx::query(
                    "INSERT INTO repositories (id, name, repo_type, config_json, capacity_bytes, used_bytes,
                     free_bytes, encrypted, immutable, status, created_at, updated_at)
                     VALUES ('repo-1', 'main', 'local', '{}', 0, 0, 0, 0, 0, 'ready', ?1, ?1)"
                )
                .bind(t)
                .execute(pool)
                .await.unwrap();
            }
            crate::db::DbPool::Postgres(_) => {}
        }

        let engine = BackupEngineImpl::new(state.clone());
        let resp = engine.start_job(Request::new(JobConfig {
            name: "test-file-job".into(),
            job_type: "file".into(),
            backup_type: "full".into(),
            source: Some(bck_proto::Source {
                paths: vec![std::env::temp_dir().to_string_lossy().to_string()],
                ..Default::default()
            }),
            destination: Some(bck_proto::Destination {
                repository_id: "repo-1".into(),
                ..Default::default()
            }),
            ..Default::default()
        })).await.unwrap();

        let handle = resp.into_inner();
        assert!(!handle.job_id.is_empty());
        let jm = state.job_manager.lock().await;
        let job = jm.get_job(&handle.job_id).await.unwrap();
        drop(jm);
        assert!(job.is_some());
        assert_eq!(job.unwrap().job_type, "file");
    }

    #[tokio::test]
    async fn engine_list_snapshots_empty_ok() {
        let state = test_state().await;
        let engine = BackupEngineImpl::new(state);
        let resp = engine.list_snapshots(Request::new(SnapshotQuery::default())).await.unwrap();
        assert_eq!(resp.into_inner().snapshots.len(), 0);
    }

    #[tokio::test]
    async fn engine_health_ok() {
        let state = test_state().await;
        let engine = BackupEngineImpl::new(state);
        let resp = engine.check_health(Request::new(Empty {})).await.unwrap();
        assert_eq!(resp.into_inner().status, "healthy");
    }

    #[tokio::test]
    async fn sobr_tier_roundtrip() {
        let state = test_state().await;
        let svc = SobrServiceService::new(state);
        let resp = svc.add_tier(Request::new(PbSobrTier {
            name: "perf-1".into(),
            tier_type: "performance".into(),
            backend: "local".into(),
            capacity_bytes: 1000,
            priority: 1,
            ..Default::default()
        })).await.unwrap();
        let tier = resp.into_inner();
        assert!(!tier.id.is_empty());
        assert_eq!(tier.name, "perf-1");

        let list = svc.list_tiers(Request::new(Empty {})).await.unwrap().into_inner();
        assert_eq!(list.tiers.len(), 1);
    }

    #[tokio::test]
    async fn cloud_account_roundtrip() {
        let state = test_state().await;
        let svc = CloudServiceService::new(state);
        let resp = svc.register_account(Request::new(PbCloudAccount {
            name: "prod".into(),
            provider: "aws".into(),
            auth_type: "access_key".into(),
            region: "us-east-1".into(),
            ..Default::default()
        })).await.unwrap();
        let account = resp.into_inner();
        let id = account.id.clone();
        assert!(!id.is_empty());

        let list = svc.list_accounts(Request::new(Empty {})).await.unwrap().into_inner();
        assert_eq!(list.accounts.len(), 1);

        let kinds = svc.list_restorable_kinds(Request::new(AccountRef { id })).await.unwrap().into_inner();
        assert_eq!(kinds.kinds.len(), 3);
    }

    #[tokio::test]
    async fn m365_tenant_roundtrip() {
        let state = test_state().await;
        let svc = M365ServiceService::new(state);
        let resp = svc.register_tenant(Request::new(PbM365Tenant {
            tenant_id: "t-1".into(),
            name: "contoso".into(),
            auth_type: "app_only".into(),
            ..Default::default()
        })).await.unwrap();
        let tenant = resp.into_inner();
        assert!(!tenant.id.is_empty());

        let list = svc.list_tenants(Request::new(Empty {})).await.unwrap().into_inner();
        assert_eq!(list.tenants.len(), 1);
    }

    #[tokio::test]
    async fn agent_heartbeat_upserts_and_tasks_queued() {
        let state = test_state().await;
        let svc = AgentService::new(state.clone());

        // Heartbeat with an explicit agent id upserts the agent row.
        let resp = svc.heartbeat(Request::new(PbHeartbeatRequest {
            agent_id: "agent-1".into(),
            hostname: "node-1".into(),
            os_type: "linux".into(),
            os_version: "6.8".into(),
            agent_version: "0.1.0".into(),
            cpu_usage: 12.5,
            memory_usage: 34.0,
            disk_free_bytes: 100_000,
            capabilities: vec!["vss".into(), "file_backup".into()],
            ..Default::default()
        })).await.unwrap();
        assert!(resp.into_inner().accepted);

        let agents = crate::server::routes::agents::fetch_agents(&state.db).await.unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "agent-1");
        assert_eq!(agents[0].status, "online");

        // Start a backup -> a pending task is created for the agent.
        let resp = svc.start_backup(Request::new(AgentBackupConfig {
            agent_id: "agent-1".into(),
            session_id: "sess-1".into(),
            paths: vec!["/data".into()],
            use_vss: false,
            use_journal: false,
            ..Default::default()
        })).await.unwrap();
        assert_eq!(resp.into_inner().job_id, "agent-1");

        // Task was inserted into agent_tasks.
        let count: i64 = match &state.db {
            crate::db::DbPool::Sqlite(pool) => {
                sqlx::query_scalar("SELECT COUNT(*) FROM agent_tasks WHERE agent_id = 'agent-1' AND task_type = 'file_backup' AND status = 'pending'")
                    .fetch_one(pool).await.unwrap()
            }
            crate::db::DbPool::Postgres(_) => 0,
        };
        assert_eq!(count, 1);

        // ExecuteScript is disabled (fail-closed): remote script execution is
        // not dispatched through the task queue.
        let err = svc.execute_script(Request::new(PbScriptRequest {
            agent_id: "agent-1".into(),
            script_content: "echo hi".into(),
            interpreter: "bash".into(),
            timeout: 30,
        })).await.err().expect("execute_script must be rejected");
        assert_eq!(err.code(), tonic::Code::Unimplemented);
    }

    #[tokio::test]
    async fn agent_get_status_returns_unknown_when_empty() {
        let state = test_state().await;
        let svc = AgentService::new(state);
        let resp = svc.get_status(Request::new(Empty {})).await.unwrap();
        assert_eq!(resp.into_inner().status, "unknown");
    }
}
