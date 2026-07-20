use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{self, Duration, Instant};
use tracing::{info, warn, error};

use crate::job::JobManager;
use crate::db::models::job::BackupJobModel;

#[derive(Debug, Clone)]
pub struct ScheduledJob {
    pub job_id: String,
    pub cron_expression: String,
    pub next_run: Option<Instant>,
    pub enabled: bool,
}

pub struct Scheduler {
    jobs: Arc<RwLock<HashMap<String, ScheduledJob>>>,
    job_manager: Arc<Mutex<JobManager>>,
    running: Arc<RwLock<bool>>,
}

impl Scheduler {
    pub fn new(job_manager: Arc<Mutex<JobManager>>) -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            job_manager,
            running: Arc::new(RwLock::new(false)),
        }
    }

    pub async fn add_job(&self, job: &BackupJobModel) {
        if let Some(ref schedule) = job.schedule {
            let scheduled = ScheduledJob {
                job_id: job.id.clone(),
                cron_expression: schedule.clone(),
                next_run: Self::next_cron_time(schedule),
                enabled: job.enabled,
            };
            self.jobs.write().await.insert(job.id.clone(), scheduled);
            info!("Scheduled job {} with cron: {}", job.name, schedule);
        }
    }

    pub async fn remove_job(&self, job_id: &str) {
        self.jobs.write().await.remove(job_id);
    }

    pub async fn update_job(&self, job: &BackupJobModel) {
        self.remove_job(&job.id).await;
        self.add_job(job).await;
    }

    pub async fn start(&self) {
        let mut running = self.running.write().await;
        if *running {
            warn!("Scheduler already running");
            return;
        }
        *running = true;
        drop(running);

        info!("Scheduler started");
        let jobs = self.jobs.clone();
        let job_manager = self.job_manager.clone();
        let running = self.running.clone();

        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                if !*running.read().await {
                    break;
                }

                let now = Instant::now();
                let mut to_run = Vec::new();

                {
                    let jobs_guard = jobs.read().await;
                    for (id, scheduled) in jobs_guard.iter() {
                        if let Some(next) = scheduled.next_run {
                            if next <= now && scheduled.enabled {
                                to_run.push(id.clone());
                            }
                        }
                    }
                }

                for job_id in to_run {
                    let jm = job_manager.lock().await;
                    if let Err(e) = jm.start_job(&job_id).await {
                        error!("Failed to start scheduled job {}: {}", job_id, e);
                    }

                    // Update next run
                    let mut jobs_guard = jobs.write().await;
                    if let Some(scheduled) = jobs_guard.get_mut(&job_id) {
                        scheduled.next_run = Self::next_cron_time(&scheduled.cron_expression);
                    }
                }
            }
        });
    }

    pub async fn stop(&self) {
        let mut running = self.running.write().await;
        *running = false;
        info!("Scheduler stopped");
    }

    fn next_cron_time(expression: &str) -> Option<Instant> {
        // Simplified: parse interval from cron, or default to 5 min
        // Full cron parser would use a library like `cron`
        let parts: Vec<&str> = expression.split_whitespace().collect();
        if parts.len() < 5 {
            warn!("Invalid cron expression: {}", expression);
            return None;
        }

        // Default: check every 5 minutes if cron is valid
        Some(Instant::now() + Duration::from_secs(300))
    }
}
