use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, error, warn};
use uuid::Uuid;

use anyhow::Result;
use chrono::Datelike;
use serde::{Deserialize, Serialize};

use crate::config::AppConfig;
use crate::db::DbPool;
use crate::db::models::job::BackupJobModel;
use crate::db::models::repository::RepositoryModel;
use crate::db::models::snapshot::SnapshotModel;
use crate::index::BlockIndex;
use crate::pipeline::BackupPipeline;
use crate::storage::create_backend;
use crate::types::{
    BackupManifest, BackupStats, ChunkSizeConfig, CompressionAlgorithm, ConsistencyLevel,
    EncryptionAlgorithm, JobStatus, PipelineConfig, Snapshot, SnapshotType,
};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
struct RetentionConfig {
    #[serde(default = "default_daily")]
    daily: i64,
    #[serde(default)]
    weekly: i64,
    #[serde(default)]
    monthly: i64,
}

fn default_daily() -> i64 {
    7
}

#[derive(Clone)]
enum DbVal<'a> {
    Str(&'a str),
    Int(i64),
    Float(f64),
}

impl<'a> From<&'a str> for DbVal<'a> {
    fn from(s: &'a str) -> Self {
        DbVal::Str(s)
    }
}

/// Live state for a job run.
#[derive(Debug, Clone)]
pub struct JobRuntime {
    pub status: JobStatus,
    pub progress: f64,
    pub stats: Option<BackupStats>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

impl JobRuntime {
    fn pending() -> Self {
        Self {
            status: JobStatus::Pending,
            progress: 0.0,
            stats: None,
            started_at: None,
            finished_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct JobView {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub job_type: String,
    pub backup_type: String,
    pub source_path: String,
    pub repository_id: String,
    pub schedule: Option<String>,
    pub enabled: bool,
    pub status: String,
    pub progress: f64,
    pub stats: Option<BackupStats>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub created_at: i64,
    pub last_run_at: Option<i64>,
    /// NULL = global/system job.
    pub tenant_id: Option<String>,
}

#[derive(Clone)]
pub struct JobManager {
    db: DbPool,
    config: AppConfig,
    runtimes: Arc<RwLock<HashMap<String, JobRuntime>>>,
    handles: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
    cancels: Arc<RwLock<HashMap<String, tokio_util::sync::CancellationToken>>>,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

impl JobManager {
    pub fn new(db: DbPool, config: AppConfig) -> Self {
        Self {
            db,
            config,
            runtimes: Arc::new(RwLock::new(HashMap::new())),
            handles: Arc::new(RwLock::new(HashMap::new())),
            cancels: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn index_path(&self) -> String {
        let path = &self.config.storage.default_path;
        if !path.exists() {
            let _ = std::fs::create_dir_all(path);
        }
        path.to_string_lossy().to_string()
    }

    pub async fn register_job(
        &self,
        name: &str,
        description: Option<&str>,
        job_type: &str,
        backup_type: &str,
        source_path: &str,
        repository_id: &str,
        schedule: Option<&str>,
        retention_days: Option<i32>,
        tenant_id: Option<&str>,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let source_config = serde_json::json!({ "path": source_path }).to_string();
        let retention = retention_days
            .map(|d| serde_json::json!({ "daily": d, "weekly": 0, "monthly": 0 }).to_string())
            .unwrap_or_else(|| "{\"daily\":7,\"weekly\":4,\"monthly\":12}".to_string());
        let t = now();

        match &self.db {
            DbPool::Sqlite(pool) => {
                sqlx::query(
                    "INSERT INTO backup_jobs
                     (id, name, description, job_type, backup_type, source_config, repository_id,
                      schedule, retention_config, compression, encryption, bandwidth_limit, enabled,
                      last_run_at, next_run_at, created_at, updated_at, tenant_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, NULL, ?14, ?14, ?15)"
                )
                .bind(&id)
                .bind(name)
                .bind(description.map(|s| s.to_string()))
                .bind(job_type)
                .bind(backup_type)
                .bind(&source_config)
                .bind(repository_id)
                .bind(schedule.map(|s| s.to_string()))
                .bind(&retention)
                .bind("zstd")
                .bind(if self.config.encryption.algorithm != "none" { 1i64 } else { 0i64 })
                .bind(0i64)
                .bind(1i64)
                .bind(t)
                .bind(tenant_id.map(|s| s.to_string()))
                .execute(pool)
                .await?;
            }
            DbPool::Postgres(pool) => {
                sqlx::query(
                    "INSERT INTO backup_jobs
                     (id, name, description, job_type, backup_type, source_config, repository_id,
                      schedule, retention_config, compression, encryption, bandwidth_limit, enabled,
                      last_run_at, next_run_at, created_at, updated_at, tenant_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, NULL, $14, $14, $15)"
                )
                .bind(&id)
                .bind(name)
                .bind(description.map(|s| s.to_string()))
                .bind(job_type)
                .bind(backup_type)
                .bind(&source_config)
                .bind(repository_id)
                .bind(schedule.map(|s| s.to_string()))
                .bind(&retention)
                .bind("zstd")
                .bind(if self.config.encryption.algorithm != "none" { 1i64 } else { 0i64 })
                .bind(0i64)
                .bind(1i64)
                .bind(t)
                .bind(tenant_id.map(|s| s.to_string()))
                .execute(pool)
                .await?;
            }
        }

        self.runtimes.write().await.insert(id.clone(), JobRuntime::pending());
        info!("Registered job {} ({}), repo={}", name, id, repository_id);
        Ok(id)
    }

    /// Register a VM backup job. `source_config` stores the hypervisor id and
    /// VM reference instead of a filesystem path.
    pub async fn register_vm_job(
        &self,
        name: &str,
        description: Option<&str>,
        hypervisor_id: &str,
        vm_ref: &str,
        vm_name: Option<&str>,
        repository_id: &str,
        schedule: Option<&str>,
        retention_days: Option<i32>,
        tenant_id: Option<&str>,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let source_config = serde_json::json!({
            "hypervisor_id": hypervisor_id,
            "vm_ref": vm_ref,
            "vm_name": vm_name,
        }).to_string();
        let retention = retention_days
            .map(|d| serde_json::json!({ "daily": d, "weekly": 0, "monthly": 0 }).to_string())
            .unwrap_or_else(|| "{\"daily\":7,\"weekly\":4,\"monthly\":12}".to_string());
        let t = now();

        match &self.db {
            DbPool::Sqlite(pool) => {
                sqlx::query(
                    "INSERT INTO backup_jobs
                     (id, name, description, job_type, backup_type, source_config, repository_id,
                      schedule, retention_config, compression, encryption, bandwidth_limit, enabled,
                      last_run_at, next_run_at, created_at, updated_at, tenant_id)
                     VALUES (?1, ?2, ?3, 'vm', 'full', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, NULL, ?12, ?12, ?13)"
                )
                .bind(&id)
                .bind(name)
                .bind(description.map(|s| s.to_string()))
                .bind(&source_config)
                .bind(repository_id)
                .bind(schedule.map(|s| s.to_string()))
                .bind(&retention)
                .bind("zstd")
                .bind(if self.config.encryption.algorithm != "none" { 1i64 } else { 0i64 })
                .bind(0i64)
                .bind(1i64)
                .bind(t)
                .bind(tenant_id.map(|s| s.to_string()))
                .execute(pool)
                .await?;
            }
            DbPool::Postgres(pool) => {
                sqlx::query(
                    "INSERT INTO backup_jobs
                     (id, name, description, job_type, backup_type, source_config, repository_id,
                      schedule, retention_config, compression, encryption, bandwidth_limit, enabled,
                      last_run_at, next_run_at, created_at, updated_at, tenant_id)
                     VALUES ($1, $2, $3, 'vm', 'full', $4, $5, $6, $7, $8, $9, $10, $11, NULL, NULL, $12, $12, $13)"
                )
                .bind(&id)
                .bind(name)
                .bind(description.map(|s| s.to_string()))
                .bind(&source_config)
                .bind(repository_id)
                .bind(schedule.map(|s| s.to_string()))
                .bind(&retention)
                .bind("zstd")
                .bind(if self.config.encryption.algorithm != "none" { 1i64 } else { 0i64 })
                .bind(0i64)
                .bind(1i64)
                .bind(t)
                .bind(tenant_id.map(|s| s.to_string()))
                .execute(pool)
                .await?;
            }
        }

        self.runtimes.write().await.insert(id.clone(), JobRuntime::pending());
        info!("Registered VM job {} ({}), hypervisor={}, vm={}", name, id, hypervisor_id, vm_ref);
        Ok(id)
    }

    pub async fn update_job(
        &self,
        id: &str,
        name: Option<&str>,
        schedule: Option<Option<&str>>,
        enabled: Option<bool>,
    ) -> Result<bool> {
        let mut updated = false;

        if let Some(name) = name {
            self.db_exec(
                "UPDATE backup_jobs SET name = ?, updated_at = ? WHERE id = ?",
                &[name.into(), DbVal::Int(now()), id.into()],
            ).await?;
            updated = true;
        }
        if let Some(schedule) = schedule {
            let val = schedule.unwrap_or("");
            self.db_exec(
                "UPDATE backup_jobs SET schedule = ?, updated_at = ? WHERE id = ?",
                &[val.into(), DbVal::Int(now()), id.into()],
            ).await?;
            updated = true;
        }
        if let Some(enabled) = enabled {
            self.db_exec(
                "UPDATE backup_jobs SET enabled = ?, updated_at = ? WHERE id = ?",
                &[DbVal::Int(if enabled { 1 } else { 0 }), DbVal::Int(now()), id.into()],
            ).await?;
            updated = true;
        }

        Ok(updated)
    }

    async fn db_exec(&self, sql: &str, args: &[DbVal<'_>]) -> Result<()> {
        match &self.db {
            DbPool::Sqlite(pool) => {
                let mut q = sqlx::query(sql);
                for a in args {
                    match a {
                        DbVal::Str(s) => { q = q.bind(s); }
                        DbVal::Int(i) => { q = q.bind(i); }
                        DbVal::Float(f) => { q = q.bind(f); }
                    }
                }
                q.execute(pool).await?;
            }
            DbPool::Postgres(pool) => {
                let mut sql = sql.to_string();
                let mut n = 0;
                let mut i = 0;
                while let Some(pos) = sql[i..].find('?') {
                    n += 1;
                    let abs = i + pos;
                    sql.replace_range(abs..abs + 1, &format!("${}", n));
                    i = abs + format!("${}", n).len();
                }
                let mut q = sqlx::query(&sql);
                for a in args {
                    match a {
                        DbVal::Str(s) => { q = q.bind(s); }
                        DbVal::Int(v) => { q = q.bind(v); }
                        DbVal::Float(v) => { q = q.bind(v); }
                    }
                }
                q.execute(pool).await?;
            }
        }
        Ok(())
    }

    pub async fn delete_job(&self, id: &str) -> Result<bool> {
        self.cancel_job(id).await?;
        let count = match &self.db {
            DbPool::Sqlite(pool) => {
                sqlx::query("DELETE FROM backup_jobs WHERE id = ?1")
                    .bind(id)
                    .execute(pool)
                    .await?
                    .rows_affected()
            }
            DbPool::Postgres(pool) => {
                sqlx::query("DELETE FROM backup_jobs WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?
                    .rows_affected()
            }
        };
        self.runtimes.write().await.remove(id);
        Ok(count > 0)
    }

    pub async fn list_jobs(&self) -> Result<Vec<JobView>> {
        let rows = self.load_jobs().await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(self.view_of(&row).await?);
        }
        Ok(out)
    }

    pub async fn load_job_models(&self) -> Result<Vec<BackupJobModel>> {
        self.load_jobs().await
    }

    pub async fn get_job(&self, id: &str) -> Result<Option<JobView>> {
        let rows = self.load_jobs().await?;
        let row = rows.into_iter().find(|r| r.id == id);
        match row {
            Some(r) => Ok(Some(self.view_of(&r).await?)),
            None => Ok(None),
        }
    }

    async fn load_jobs(&self) -> Result<Vec<BackupJobModel>> {
        match &self.db {            DbPool::Sqlite(pool) => {
                let rows = sqlx::query_as::<_, BackupJobModel>(
                    "SELECT id, name, description, job_type, backup_type, source_config,
                            repository_id, schedule, retention_config, compression, encryption,
                            bandwidth_limit, enabled, last_run_at, next_run_at, created_at, updated_at, tenant_id
                     FROM backup_jobs ORDER BY created_at DESC"
                )
                .fetch_all(pool)
                .await?;
                Ok(rows)
            }
            DbPool::Postgres(pool) => {
                let rows = sqlx::query_as::<_, BackupJobModel>(
                    "SELECT id, name, description, job_type, backup_type, source_config,
                            repository_id, schedule, retention_config, compression, encryption,
                            bandwidth_limit, enabled, last_run_at, next_run_at, created_at, updated_at, tenant_id
                     FROM backup_jobs ORDER BY created_at DESC"
                )
                .fetch_all(pool)
                .await?;
                Ok(rows)
            }
        }
    }

    async fn load_job(&self, id: &str) -> Result<Option<BackupJobModel>> {
        match &self.db {
            DbPool::Sqlite(pool) => {
                let row = sqlx::query_as::<_, BackupJobModel>(
                    "SELECT id, name, description, job_type, backup_type, source_config,
                            repository_id, schedule, retention_config, compression, encryption,
                            bandwidth_limit, enabled, last_run_at, next_run_at, created_at, updated_at, tenant_id
                     FROM backup_jobs WHERE id = ?1"
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;
                Ok(row)
            }
            DbPool::Postgres(pool) => {
                let row = sqlx::query_as::<_, BackupJobModel>(
                    "SELECT id, name, description, job_type, backup_type, source_config,
                            repository_id, schedule, retention_config, compression, encryption,
                            bandwidth_limit, enabled, last_run_at, next_run_at, created_at, updated_at, tenant_id
                     FROM backup_jobs WHERE id = $1"
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;
                Ok(row)
            }
        }
    }

    async fn last_session_status(&self, job_id: &str) -> Result<Option<String>> {
        match &self.db {
            DbPool::Sqlite(pool) => {
                let status = sqlx::query_scalar::<_, String>(
                    "SELECT status FROM job_sessions WHERE job_id = ?1 ORDER BY started_at DESC LIMIT 1"
                )
                .bind(job_id)
                .fetch_optional(pool)
                .await?;
                Ok(status)
            }
            DbPool::Postgres(pool) => {
                let status = sqlx::query_scalar::<_, String>(
                    "SELECT status FROM job_sessions WHERE job_id = $1 ORDER BY started_at DESC LIMIT 1"
                )
                .bind(job_id)
                .fetch_optional(pool)
                .await?;
                Ok(status)
            }
        }
    }

    async fn view_of(&self, job: &BackupJobModel) -> Result<JobView> {
        let source_path = serde_json::from_str::<serde_json::Value>(&job.source_config)
            .ok()
            .and_then(|v| v["path"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();

        let runtime = self.runtimes.read().await.get(&job.id).cloned();
        let (status, progress, stats, started_at, finished_at) = match runtime {
            Some(rt) => (rt.status, rt.progress, rt.stats, rt.started_at, rt.finished_at),
            None => {
                let st = self.last_session_status(&job.id).await?;
                let status = match st.as_deref() {
                    Some("completed") => JobStatus::Completed,
                    Some("failed") => JobStatus::Failed("see session".into()),
                    Some("cancelled") => JobStatus::Cancelled,
                    Some("running") => JobStatus::Running,
                    _ => JobStatus::Pending,
                };
                (status, 0.0, None, job.last_run_at, None)
            }
        };

        Ok(JobView {
            id: job.id.clone(),
            name: job.name.clone(),
            description: job.description.clone(),
            job_type: job.job_type.clone(),
            backup_type: job.backup_type.clone(),
            source_path,
            repository_id: job.repository_id.clone(),
            schedule: job.schedule.clone(),
            enabled: job.enabled,
            status: job_status_string(&status),
            progress,
            stats,
            started_at,
            finished_at,
            created_at: job.created_at,
            last_run_at: job.last_run_at,
            tenant_id: job.tenant_id.clone(),
        })
    }

    /// Mark sessions that were still "running" when the daemon restarted as
    /// failed, and drop stale in-memory runtimes. Without this the UI would
    /// show permanent "running" jobs that can never finish.
    pub async fn reconcile_startup(&self) {
        match &self.db {
            DbPool::Sqlite(pool) => {
                let _ = sqlx::query(
                    "UPDATE job_sessions SET status = 'failed', error_message = 'interrupted by daemon restart'
                     WHERE status = 'running'",
                )
                .execute(pool)
                .await;
            }
            DbPool::Postgres(pool) => {
                let _ = sqlx::query(
                    "UPDATE job_sessions SET status = 'failed', error_message = 'interrupted by daemon restart'
                     WHERE status = 'running'",
                )
                .execute(pool)
                .await;
            }
        }
        self.runtimes.write().await.clear();
        self.cancels.write().await.clear();
    }

    /// Start a backup job. Runs the real backup pipeline in the background and
    /// records the resulting snapshot in the database.
    pub async fn start_job(&self, id: &str) -> Result<()> {
        let job = self.load_job(id).await?
            .ok_or_else(|| anyhow::anyhow!("Job not found: {}", id))?;

        // Check-and-insert under a single write lock so two concurrent callers
        // cannot start the same job twice (TOCTOU).
        {
            let mut runtimes = self.runtimes.write().await;
            if let Some(rt) = runtimes.get(id) {
                if rt.status == JobStatus::Running {
                    anyhow::bail!("Job already running");
                }
            }
            runtimes.insert(
                id.to_string(),
                JobRuntime {
                    status: JobStatus::Running,
                    progress: 0.0,
                    stats: None,
                    started_at: Some(now()),
                    finished_at: None,
                },
            );
        }

        let session_id = Uuid::new_v4().to_string();
        let t = now();
        self.insert_session(&session_id, id, &job.backup_type, t).await?;

        let jm = self.clone();
        let run_id = id.to_string();
        let sess = session_id.clone();
        let token = tokio_util::sync::CancellationToken::new();
        self.cancels.write().await.insert(run_id.clone(), token.clone());
        let handle = tokio::spawn(async move {
            jm.run_backup(job, sess, run_id, token).await;
        });
        self.handles.write().await.insert(id.to_string(), handle);
        info!("Started job {} (session {})", id, session_id);
        Ok(())
    }

    async fn insert_session(&self, session_id: &str, job_id: &str, backup_type: &str, t: i64) -> Result<()> {
        match &self.db {
            DbPool::Sqlite(pool) => {
                sqlx::query(
                    "INSERT INTO job_sessions (id, job_id, status, backup_type, started_at, created_at)
                     VALUES (?1, ?2, 'running', ?3, ?4, ?4)"
                )
                .bind(session_id)
                .bind(job_id)
                .bind(backup_type)
                .bind(t)
                .execute(pool)
                .await?;
            }
            DbPool::Postgres(pool) => {
                sqlx::query(
                    "INSERT INTO job_sessions (id, job_id, status, backup_type, started_at, created_at)
                     VALUES ($1, $2, 'running', $3, $4, $4)"
                )
                .bind(session_id)
                .bind(job_id)
                .bind(backup_type)
                .bind(t)
                .execute(pool)
                .await?;
            }
        }
        Ok(())
    }

    async fn run_backup(
        &self,
        job: BackupJobModel,
        session_id: String,
        job_id: String,
        cancel: tokio_util::sync::CancellationToken,
    ) {
        // Check cancellation before doing any work so a cancelled job exits
        // cleanly instead of being torn down by abort() mid-pipeline.
        if cancel.is_cancelled() {
            let t = now();
            self.db_exec(
                "UPDATE job_sessions SET status = 'cancelled', finished_at = ?, error_message = ? WHERE id = ?",
                &[DbVal::Int(t), DbVal::Str("cancelled before start"), DbVal::Str(&session_id)],
            ).await.ok();
            self.finish_runtime(&job_id, JobStatus::Cancelled, None, Some(t), None).await;
            return;
        }

        let result = self.run_backup_inner(&job, &session_id, &cancel).await;

        match result {
            Ok((snapshot, stats)) => {
                let t = now();
                self.complete_session(&session_id, &stats, t).await;
                self.finish_runtime(&job_id, JobStatus::Completed, Some(stats.clone()), Some(t), None).await;
                let _ = self.update_job_last_run(&job_id, t).await;
                crate::db::record_event(
                    &self.db,
                    "job_completed",
                    "scheduler",
                    &format!("Job {} completed, snapshot {} created", job.name, snapshot.id),
                    Some(&job_id),
                    Some(&session_id),
                ).await.ok();
                info!("Job {} completed (snapshot {})", job.name, snapshot.id);
                if let Err(e) = self.apply_retention(&job).await {
                    error!("Job {} retention failed: {}", job.name, e);
                }
            }
            Err(e) => {
                let t = now();
                self.fail_session(&session_id, &e.to_string(), t).await;
                self.finish_runtime(&job_id, JobStatus::Failed(e.to_string()), None, Some(t), None).await;
                crate::db::record_event(
                    &self.db,
                    "job_failed",
                    "scheduler",
                    &format!("Job {} failed: {}", job.name, e),
                    Some(&job_id),
                    Some(&session_id),
                ).await.ok();
                error!("Job {} failed: {}", job.name, e);
            }
        }
    }

    async fn run_backup_inner(
        &self,
        job: &BackupJobModel,
        session_id: &str,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<(Snapshot, BackupStats)> {
        if job.job_type == "vm" {
            return self.run_vm_backup(job, session_id, cancel).await;
        }

        let repo = self.load_repository(&job.repository_id).await?
            .ok_or_else(|| anyhow::anyhow!("Repository not found: {}", job.repository_id))?;
        info!("Job {}: repo loaded {} type={}", job.id, repo.id, repo.repo_type);

        let source_path = serde_json::from_str::<serde_json::Value>(&job.source_config)
            .ok()
            .and_then(|v| v["path"].as_str().map(|s| s.to_string()))
            .ok_or_else(|| anyhow::anyhow!("Invalid source_config for job {}", job.id))?;
        info!("Job {}: source={} encryption={}", job.id, source_path, job.encryption);

        let mut pipeline = self.build_pipeline(job)?;

        let storage = self.build_storage(&repo).await
            .map_err(|e| anyhow::anyhow!("build_storage failed for repo {}: {}", repo.id, e))?;
        let result = pipeline.run(&source_path, storage.as_ref())
            .await
            .map_err(|e| anyhow::anyhow!("pipeline run failed for {}: {}", source_path, e))?;

        // Save manifest + snapshot record
        let snapshot_id = Uuid::new_v4().to_string();
        let t = now();
        let checksum = compute_checksum(&result.blocks);
        let manifest = BackupManifest {
            snapshot_id: snapshot_id.clone(),
            parent_id: None,
            blocks: result.blocks.clone(),
            total_size: result.stats.total_bytes,
            unique_size: result.stats.unique_bytes,
            compressed_size: result.stats.compressed_bytes,
            file_count: result.stats.files_processed,
            checksum: checksum.clone(),
            created_at: t,
        };

        let index = BlockIndex::new(&self.index_path())?;
        index.save_manifest(&snapshot_id, &manifest)?;

        let snapshot = Snapshot {
            id: snapshot_id.clone(),
            job_id: job.id.clone(),
            repository_id: job.repository_id.clone(),
            snapshot_type: SnapshotType::Full,
            parent_id: None,
            size_bytes: result.stats.total_bytes,
            unique_bytes: result.stats.unique_bytes,
            compressed_bytes: result.stats.compressed_bytes,
            checksum: checksum.clone(),
            consistency: ConsistencyLevel::Consistent,
            app_consistent: false,
            created_at: t,
            manifest_path: self.index_path(),
            tenant_id: job.tenant_id.clone(),
        };
        index.add_snapshot(&snapshot)?;

        self.insert_snapshot(&snapshot, session_id).await?;
        self.update_repo_used(&job.repository_id, result.stats.compressed_bytes).await?;

        Ok((snapshot, result.stats))
    }

    /// Run a VM backup job: connect to the hypervisor, snapshot the VM, stream
    /// its virtual disks through the pipeline into the repository, then record
    /// the resulting snapshot and update the VM protection status.
    async fn run_vm_backup(
        &self,
        job: &BackupJobModel,
        session_id: &str,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<(Snapshot, BackupStats)> {
        let cfg: serde_json::Value = serde_json::from_str(&job.source_config)
            .unwrap_or_else(|_| serde_json::json!({}));
        let hypervisor_id = cfg["hypervisor_id"].as_str()
            .ok_or_else(|| anyhow::anyhow!("VM job {} missing hypervisor_id", job.id))?;
        let vm_ref = cfg["vm_ref"].as_str()
            .ok_or_else(|| anyhow::anyhow!("VM job {} missing vm_ref", job.id))?;
        let vm_name = cfg["vm_name"].as_str().unwrap_or("vm");
        info!(
            "VM job {}: hypervisor={} vm={} (ref {})",
            job.id, hypervisor_id, vm_name, vm_ref
        );

        let hv = crate::db::hypervisor::fetch_hypervisor(&self.db, hypervisor_id).await?
            .ok_or_else(|| anyhow::anyhow!("Hypervisor not found: {}", hypervisor_id))?;
        let key = crate::encrypt::app_key(&self.config).ok();
        let connector = crate::db::hypervisor::connector_from_model(&hv, key.as_deref())?;

        let repo = self.load_repository(&job.repository_id).await?
            .ok_or_else(|| anyhow::anyhow!("Repository not found: {}", job.repository_id))?;
        let storage = self.build_storage(&repo).await?;
        let mut pipeline = self.build_pipeline(job)?;

        let result = crate::backup::vm::VmBackupJob::new(connector.as_ref(), vm_ref)
            .run(&mut pipeline, storage.as_ref(), cancel.clone())
            .await
            .map_err(|e| anyhow::anyhow!("VM backup failed for {}: {}", vm_ref, e))?;

        info!(
            "VM job {}: backed up {} disks ({} changed), {} bytes",
            job.id, result.total_disks, result.changed_disks, result.stats.total_bytes
        );

        // Save manifest + snapshot record
        let snapshot_id = Uuid::new_v4().to_string();
        let t = now();
        let checksum = compute_checksum(&result.blocks);
        let manifest = BackupManifest {
            snapshot_id: snapshot_id.clone(),
            parent_id: None,
            blocks: result.blocks.clone(),
            total_size: result.stats.total_bytes,
            unique_size: result.stats.unique_bytes,
            compressed_size: result.stats.compressed_bytes,
            file_count: result.total_disks as u64,
            checksum: checksum.clone(),
            created_at: t,
        };

        let index = BlockIndex::new(&self.index_path())?;
        index.save_manifest(&snapshot_id, &manifest)?;

        let snapshot = Snapshot {
            id: snapshot_id.clone(),
            job_id: job.id.clone(),
            repository_id: job.repository_id.clone(),
            snapshot_type: SnapshotType::Full,
            parent_id: None,
            size_bytes: result.stats.total_bytes,
            unique_bytes: result.stats.unique_bytes,
            compressed_bytes: result.stats.compressed_bytes,
            checksum: checksum.clone(),
            consistency: ConsistencyLevel::Consistent,
            app_consistent: true,
            created_at: t,
            manifest_path: self.index_path(),
            tenant_id: job.tenant_id.clone(),
        };
        index.add_snapshot(&snapshot)?;

        self.insert_snapshot(&snapshot, session_id).await?;
        self.update_repo_used(&job.repository_id, result.stats.compressed_bytes).await?;
        crate::db::hypervisor::mark_vm_backed_up(&self.db, hypervisor_id, vm_ref, t).await?;

        Ok((snapshot, result.stats))
    }

    /// Build the backup pipeline (compression + encryption + dedup) for a job.
    fn build_pipeline(&self, job: &BackupJobModel) -> Result<BackupPipeline> {
        let compression = match job.compression.as_str() {
            "lz4" => CompressionAlgorithm::Lz4,
            "none" => CompressionAlgorithm::None,
            _ => CompressionAlgorithm::Zstd { level: 3 },
        };

        let encryption = if job.encryption {
            match self.config.encryption.algorithm.to_lowercase().as_str() {
                "chacha20-poly1305" => EncryptionAlgorithm::ChaCha20Poly1305,
                "none" => EncryptionAlgorithm::None,
                _ => EncryptionAlgorithm::Aes256Gcm,
            }
        } else {
            EncryptionAlgorithm::None
        };

        let key = if encryption != EncryptionAlgorithm::None {
            let key_path = self.config.encryption.key_path.clone()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| crate::encrypt::default_key_path(&self.config));
            Some(crate::encrypt::load_key(&key_path, self.config.encryption.passphrase.as_deref())?)
        } else {
            None
        };

        let pipeline_config = PipelineConfig {
            compression,
            encryption,
            encryption_key: key.clone(),
            chunk_size: ChunkSizeConfig::default(),
            throttle: None,
        };

        let mut pipeline = BackupPipeline::new(pipeline_config);
        pipeline = pipeline.with_dedup(&self.index_path())
            .map_err(|e| anyhow::anyhow!("with_dedup failed (index {}): {}", self.index_path(), e))?;
        Ok(pipeline)
    }

    async fn load_repository(&self, id: &str) -> Result<Option<RepositoryModel>> {
        match &self.db {
            DbPool::Sqlite(pool) => {
                let row = sqlx::query_as::<_, RepositoryModel>(
                    "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                            free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
                     FROM repositories WHERE id = ?1"
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;
                Ok(row)
            }
            DbPool::Postgres(pool) => {
                let row = sqlx::query_as::<_, RepositoryModel>(
                    "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                            free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
                     FROM repositories WHERE id = $1"
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;
                Ok(row)
            }
        }
    }

    async fn build_storage(&self, repo: &RepositoryModel) -> Result<Box<dyn crate::storage::StorageBackend>> {
        let cfg: serde_json::Value = serde_json::from_str(&repo.config_json)
            .unwrap_or_else(|_| serde_json::json!({}));

        let key = crate::encrypt::app_key(&self.config).ok();
        let mut storage_config = crate::storage::storage_config_from_json(&cfg, key.as_deref());
        storage_config.backend_type = repo.repo_type.clone();
        create_backend(storage_config).await
    }

    async fn insert_snapshot(&self, snapshot: &Snapshot, session_id: &str) -> Result<()> {
        match &self.db {
            DbPool::Sqlite(pool) => {
                sqlx::query(
                    "INSERT INTO snapshots
                     (id, job_id, session_id, repository_id, snapshot_type, parent_id,
                      size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                      app_consistent, created_at, tenant_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"
                )
                .bind(&snapshot.id)
                .bind(&snapshot.job_id)
                .bind(session_id)
                .bind(&snapshot.repository_id)
                .bind(snapshot_type_str(&snapshot.snapshot_type))
                .bind(&snapshot.parent_id)
                .bind(snapshot.size_bytes as i64)
                .bind(snapshot.unique_bytes as i64)
                .bind(snapshot.compressed_bytes as i64)
                .bind(&snapshot.checksum)
                .bind(consistency_str(&snapshot.consistency))
                .bind(snapshot.app_consistent)
                .bind(snapshot.created_at)
                .bind(&snapshot.tenant_id)
                .execute(pool)
                .await?;
            }
            DbPool::Postgres(pool) => {
                sqlx::query(
                    "INSERT INTO snapshots
                     (id, job_id, session_id, repository_id, snapshot_type, parent_id,
                      size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                      app_consistent, created_at, tenant_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
                )
                .bind(&snapshot.id)
                .bind(&snapshot.job_id)
                .bind(session_id)
                .bind(&snapshot.repository_id)
                .bind(snapshot_type_str(&snapshot.snapshot_type))
                .bind(&snapshot.parent_id)
                .bind(snapshot.size_bytes as i64)
                .bind(snapshot.unique_bytes as i64)
                .bind(snapshot.compressed_bytes as i64)
                .bind(&snapshot.checksum)
                .bind(consistency_str(&snapshot.consistency))
                .bind(if snapshot.app_consistent { 1i64 } else { 0i64 })
                .bind(snapshot.created_at)
                .bind(&snapshot.tenant_id)
                .execute(pool)
                .await?;
            }
        }
        Ok(())
    }

    async fn update_repo_used(&self, repo_id: &str, bytes: u64) -> Result<()> {
        // Check capacity before updating to avoid over-provision.
        if let Some(repo) = self.load_repository(repo_id).await? {
            if repo.capacity_bytes > 0 && repo.used_bytes + bytes as i64 > repo.capacity_bytes {
                anyhow::bail!("repository {} capacity exceeded: {} + {} > {}", repo_id, repo.used_bytes, bytes, repo.capacity_bytes);
            }
        }
        self.db_exec(
            "UPDATE repositories SET used_bytes = used_bytes + ?, updated_at = ? WHERE id = ?",
            &[DbVal::Int(bytes as i64), DbVal::Int(now()), repo_id.into()],
        ).await
    }

    async fn load_job_snapshots(&self, job_id: &str) -> Result<Vec<SnapshotModel>> {
        match &self.db {
            DbPool::Sqlite(pool) => {
                let rows = sqlx::query_as::<_, SnapshotModel>(
                    "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                            size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                            app_consistent, created_at, tenant_id
                     FROM snapshots WHERE job_id = ?1 ORDER BY created_at DESC"
                )
                .bind(job_id)
                .fetch_all(pool)
                .await?;
                Ok(rows)
            }
            DbPool::Postgres(pool) => {
                let rows = sqlx::query_as::<_, SnapshotModel>(
                    "SELECT id, job_id, session_id, repository_id, snapshot_type, parent_id,
                            size_bytes, unique_bytes, compressed_bytes, checksum, consistency,
                            app_consistent, created_at, tenant_id
                     FROM snapshots WHERE job_id = $1 ORDER BY created_at DESC"
                )
                .bind(job_id)
                .fetch_all(pool)
                .await?;
                Ok(rows)
            }
        }
    }

    /// Delete a snapshot and run garbage collection: decrement block refcounts
    /// in the block index, drop the manifest, delete physical blocks that are
    /// no longer referenced by any snapshot, and finally remove the row from
    /// the application database. Without this the block store grew forever.
    pub async fn delete_snapshot_with_gc(&self, snapshot_id: &str, repository_id: &str) -> Result<()> {
        let index = BlockIndex::new(&self.index_path())?;
        let mut orphans = Vec::new();
        if let Some(manifest) = index.load_manifest(snapshot_id)? {
            for block in &manifest.blocks {
                if index.remove_block(&block.block_id.sha256)? {
                    orphans.push(block.block_id.sha256.clone());
                }
            }
        }
        index.delete_snapshot(snapshot_id)?;

        // Perform orphan block deletions before DB row removal; if storage fails we still remove DB row
        // but log the orphan for later reconciliation. Wrap DB delete in transaction where possible.
        if !orphans.is_empty() {
            if let Some(repo) = self.load_repository(repository_id).await? {
                if let Ok(storage) = self.build_storage(&repo).await {
                    for id in &orphans {
                        if let Err(e) = storage.delete_block(id).await {
                            tracing::warn!("Failed to delete orphan block {}: {}", id, e);
                        }
                    }
                }
            }
        }

        match &self.db {
            DbPool::Sqlite(pool) => {
                sqlx::query("DELETE FROM snapshots WHERE id = ?1")
                    .bind(snapshot_id)
                    .execute(pool)
                    .await?;
            }
            DbPool::Postgres(pool) => {
                sqlx::query("DELETE FROM snapshots WHERE id = $1")
                    .bind(snapshot_id)
                    .execute(pool)
                    .await?;
            }
        }
        Ok(())
    }

    /// Apply GFS retention policy (daily / weekly / monthly) after a successful run.
    /// Keeps the newest snapshot per day within the daily window, per ISO week within
    /// the weekly window, and per month within the monthly window. Older copies are pruned.
    async fn apply_retention(&self, job: &BackupJobModel) -> Result<()> {
        let cfg: RetentionConfig = match serde_json::from_str(&job.retention_config) {
            Ok(c) => c,
            Err(_) => RetentionConfig { daily: 7, weekly: 4, monthly: 12 },
        };

        let snapshots = self.load_job_snapshots(&job.id).await?;
        if snapshots.len() <= 1 {
            return Ok(());
        }

        let now_dt = chrono::DateTime::<chrono::Utc>::from_timestamp(now(), 0)
            .unwrap_or_else(chrono::Utc::now);

        let mut keep = std::collections::HashSet::new();
        let mut day_seen: std::collections::HashSet<(i32, u32, u32)> = std::collections::HashSet::new();
        let mut week_seen: std::collections::HashSet<(i32, u32)> = std::collections::HashSet::new();
        let mut month_seen: std::collections::HashSet<(i32, u32)> = std::collections::HashSet::new();

        for s in &snapshots {
            let Some(dt) = chrono::DateTime::<chrono::Utc>::from_timestamp(s.created_at, 0) else { continue };
            let days_diff = (now_dt - dt).num_days();
            let iso_week = dt.iso_week();
            let day_key = (dt.year(), dt.month(), dt.day());
            let week_key = (iso_week.year(), iso_week.week());
            let month_key = (dt.year(), dt.month());

            if days_diff >= 0 && days_diff < cfg.daily as i64 && day_seen.insert(day_key) {
                keep.insert(s.id.clone());
            }
            if days_diff < 0 && day_seen.insert(day_key) {
                keep.insert(s.id.clone());
            }
            if cfg.weekly > 0 && week_seen.insert(week_key) && week_seen.len() as i64 <= cfg.weekly {
                keep.insert(s.id.clone());
            }
            if cfg.monthly > 0 && month_seen.insert(month_key) && month_seen.len() as i64 <= cfg.monthly {
                keep.insert(s.id.clone());
            }
        }

        // Always keep the most recent snapshot.
        if let Some(newest) = snapshots.first() {
            keep.insert(newest.id.clone());
        }

        let removed = snapshots
            .into_iter()
            .filter(|s| !keep.contains(&s.id))
            .collect::<Vec<_>>();

        if removed.is_empty() {
            return Ok(());
        }

        info!(
            "Retention {}: pruning {} old snapshots (keep {})",
            job.name,
            removed.len(),
            keep.len()
        );

        for s in &removed {
            self.delete_snapshot_with_gc(&s.id, &s.repository_id).await?;
            crate::db::record_event(
                &self.db,
                "snapshot_pruned",
                "retention",
                &format!("Retention pruned snapshot {} ({})", s.id, s.snapshot_type),
                Some(&job.id),
                Some(s.session_id.as_str()),
            ).await.ok();
        }
        Ok(())
    }

    async fn update_job_last_run(&self, job_id: &str, t: i64) -> Result<()> {
        self.db_exec(
            "UPDATE backup_jobs SET last_run_at = ?, updated_at = ? WHERE id = ?",
            &[DbVal::Int(t), DbVal::Int(now()), job_id.into()],
        ).await
    }

    async fn complete_session(&self, session_id: &str, stats: &BackupStats, t: i64) {
        self.db_exec(
            "UPDATE job_sessions SET status = 'completed', finished_at = ?, total_bytes = ?,
             processed_bytes = ?, transferred_bytes = ?, dedup_ratio = ?, compression_ratio = ?,
             files_processed = ? WHERE id = ?",
            &[
                DbVal::Int(t),
                DbVal::Int(stats.total_bytes as i64),
                DbVal::Int(stats.unique_bytes as i64),
                DbVal::Int(stats.transferred_bytes as i64),
                DbVal::Float(stats.dedup_ratio),
                DbVal::Float(stats.compression_ratio),
                DbVal::Int(stats.files_processed as i64),
                session_id.into(),
            ],
        ).await.ok();
    }

    async fn fail_session(&self, session_id: &str, err: &str, t: i64) {
        self.db_exec(
            "UPDATE job_sessions SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?",
            &[DbVal::Int(t), err.into(), session_id.into()],
        ).await.ok();
    }

    async fn finish_runtime(
        &self,
        job_id: &str,
        status: JobStatus,
        stats: Option<BackupStats>,
        finished_at: Option<i64>,
        _progress: Option<f64>,
    ) {
        if let Some(rt) = self.runtimes.write().await.get_mut(job_id) {
            rt.status = status;
            rt.stats = stats;
            rt.finished_at = finished_at;
            rt.progress = if rt.status == JobStatus::Completed { 100.0 } else { rt.progress };
        }
        self.handles.write().await.remove(job_id);
        self.cancels.write().await.remove(job_id);
    }

    pub async fn cancel_job(&self, id: &str) -> Result<bool> {
        // Graceful cancellation: signal the job's token so it can finish its
        // current step and clean up (e.g. remove the hypervisor snapshot).
        let token = self.cancels.write().await.remove(id);
        if let Some(tok) = token {
            tok.cancel();
        }

        let handle = self.handles.write().await.remove(id);
        if let Some(mut h) = handle {
            // Give the job a short grace period to observe the token and finish
            // cleanly; abort() is only a last resort if it is stuck.
            match tokio::time::timeout(std::time::Duration::from_secs(10), &mut h).await {
                Ok(_) => info!("Job {} stopped gracefully", id),
                Err(_) => {
                    warn!("Job {} did not stop within grace period; aborting task", id);
                    h.abort();
                }
            }
        }

        let t = now();
        let exists = match &self.db {
            DbPool::Sqlite(pool) => {
                sqlx::query("UPDATE job_sessions SET status = 'cancelled', finished_at = ?1 WHERE job_id = ?2 AND status = 'running'")
                    .bind(t)
                    .bind(id)
                    .execute(pool)
                    .await?
                    .rows_affected()
            }
            DbPool::Postgres(pool) => {
                sqlx::query("UPDATE job_sessions SET status = 'cancelled', finished_at = $1 WHERE job_id = $2 AND status = 'running'")
                    .bind(t)
                    .bind(id)
                    .execute(pool)
                    .await?
                    .rows_affected()
            }
        };

        if let Some(rt) = self.runtimes.write().await.get_mut(id) {
            rt.status = JobStatus::Cancelled;
            rt.finished_at = Some(t);
        }

        // Determine if the job exists at all.
        let job_exists = self.load_job(id).await?.is_some();
        info!("Job {} cancelled", id);
        Ok(job_exists || exists > 0)
    }

    /// Update a job with new schedule/enabled/name from the scheduler.
    pub async fn reschedule(&self, job: &BackupJobModel) -> Result<()> {
        let _ = job;
        Ok(())
    }
}

pub fn job_status_string(status: &JobStatus) -> String {
    match status {
        JobStatus::Pending => "pending".into(),
        JobStatus::Running => "running".into(),
        JobStatus::Completed => "completed".into(),
        JobStatus::Failed(e) => format!("failed: {}", e),
        JobStatus::Cancelled => "cancelled".into(),
    }
}

fn snapshot_type_str(t: &SnapshotType) -> String {
    match t {
        SnapshotType::Full => "full".into(),
        SnapshotType::Incremental => "incremental".into(),
        SnapshotType::Differential => "differential".into(),
        SnapshotType::SyntheticFull => "synthetic_full".into(),
    }
}

fn consistency_str(c: &ConsistencyLevel) -> String {
    match c {
        ConsistencyLevel::Consistent => "consistent".into(),
        ConsistencyLevel::CrashConsistent => "crash_consistent".into(),
    }
}

fn compute_checksum(blocks: &[crate::types::FileBlock]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for b in blocks {
        hasher.update(b.block_id.sha256.as_bytes());
    }
    hex::encode(hasher.finalize())
}
