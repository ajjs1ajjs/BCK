use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, error};
use uuid::Uuid;

use crate::types::{BackupStats, JobInfo, JobStatus};

pub struct JobManager {
    jobs: Arc<RwLock<HashMap<String, JobInfo>>>,
    active_runs: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
}

impl JobManager {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            active_runs: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register_job(&self, name: &str) -> String {
        let id = Uuid::new_v4().to_string();
        let job = JobInfo {
            id: uuid::Uuid::parse_str(&id).unwrap(),
            name: name.to_string(),
            status: JobStatus::Pending,
            progress: 0.0,
            stats: None,
            started_at: None,
            finished_at: None,
        };
        self.jobs.write().await.insert(id.clone(), job);
        id
    }

    pub async fn start_job(&self, job_id: &str) -> Result<(), anyhow::Error> {
        let mut jobs = self.jobs.write().await;
        let job = jobs.get_mut(job_id)
            .ok_or_else(|| anyhow::anyhow!("Job not found: {}", job_id))?;

        if job.status == JobStatus::Running {
            anyhow::bail!("Job already running");
        }

        job.status = JobStatus::Running;
        job.started_at = Some(chrono::Utc::now().timestamp());
        info!("Starting job: {} ({})", job.name, job_id);

        Ok(())
    }

    pub async fn complete_job(&self, job_id: &str, stats: BackupStats) {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            job.status = JobStatus::Completed;
            job.progress = 100.0;
            job.stats = Some(stats);
            job.finished_at = Some(chrono::Utc::now().timestamp());
            info!("Job completed: {} ({})", job.name, job_id);
        }
    }

    pub async fn fail_job(&self, job_id: &str, error: &str) {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            job.status = JobStatus::Failed(error.to_string());
            job.finished_at = Some(chrono::Utc::now().timestamp());
            error!("Job failed: {} ({}): {}", job.name, job_id, error);
        }
    }

    pub async fn cancel_job(&self, job_id: &str) -> Result<(), anyhow::Error> {
        let mut jobs = self.jobs.write().await;
        let job = jobs.get_mut(job_id)
            .ok_or_else(|| anyhow::anyhow!("Job not found: {}", job_id))?;

        job.status = JobStatus::Cancelled;
        job.finished_at = Some(chrono::Utc::now().timestamp());

        // Cancel running task
        let mut active = self.active_runs.write().await;
        if let Some(handle) = active.remove(job_id) {
            handle.abort();
        }

        info!("Job cancelled: {} ({})", job.name, job_id);
        Ok(())
    }

    pub async fn get_job(&self, job_id: &str) -> Option<JobInfo> {
        self.jobs.read().await.get(job_id).cloned()
    }

    pub async fn list_jobs(&self) -> Vec<JobInfo> {
        self.jobs.read().await.values().cloned().collect()
    }
}
