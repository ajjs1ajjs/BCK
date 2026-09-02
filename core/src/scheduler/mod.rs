use std::collections::HashMap;
use std::str::FromStr;
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
        if let Some(schedule) = &job.schedule {
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
        let parts: Vec<&str> = expression.split_whitespace().collect();
        if parts.is_empty() {
            warn!("Invalid cron expression: {}", expression);
            return None;
        }
        // The `cron` crate expects a seconds field first; accept standard
        // 5-field cron expressions by prepending `0`.
        let cron_expr = if parts.len() == 5 {
            format!("0 {}", expression)
        } else {
            expression.to_string()
        };
        let schedule = cron::Schedule::from_str(&cron_expr).ok()?;
        // Use UTC so schedule does not depend on host timezone/DST.
        let now = chrono::Utc::now();
        let next = schedule.after(&now).next()?;
        let secs = (next - now).num_seconds().max(0) as u64;
        Some(Instant::now() + Duration::from_secs(secs))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_cron_returns_none() {
        assert!(Scheduler::next_cron_time("").is_none());
        assert!(Scheduler::next_cron_time("not a cron").is_none());
    }

    #[test]
    fn valid_five_field_cron_returns_a_future_time() {
        // Daily at 02:00 — must be in the future, and (now that cron is parsed)
        // must be no more than ~24h away, not a fixed 5 minutes.
        let next = Scheduler::next_cron_time("0 2 * * *").expect("cron must parse");
        let delta = next.duration_since(Instant::now());
        assert!(delta > Duration::from_secs(60), "next run must be in the future");
        assert!(delta < Duration::from_secs(24 * 3600 + 120), "next run must respect the daily schedule");
    }

    #[test]
    fn every_five_minutes_cron() {
        let next = Scheduler::next_cron_time("*/5 * * * *").expect("cron must parse");
        let delta = next.duration_since(Instant::now());
        assert!(delta >= Duration::from_secs(0) && delta <= Duration::from_secs(300 + 5));
    }
}
