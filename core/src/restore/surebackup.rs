use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SureBackupJob {
    pub id: String,
    pub snapshot_id: String,
    pub vm_name: String,
    pub status: SureBackupStatus,
    pub test_results: Vec<TestResult>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    /// Owning tenant; used by the read paths to enforce tenant isolation
    /// (SEC-019). NULL = global (super_admin-owned).
    #[serde(default)]
    pub tenant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SureBackupStatus {
    Pending,
    CreatingLab,
    BootingVm,
    RunningTests,
    Completed,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub test_name: String,
    pub status: String,
    pub message: String,
    pub duration_seconds: u64,
}

/// SureBackup — automatic backup verification.
///
/// Boots a VM from the backup in an isolated environment, then runs a set of
/// verification tests (network reachability, guest heartbeat) and records the
/// results. Job state is tracked in-memory via [`SureBackupEngine`].
#[derive(Clone, Default)]
pub struct SureBackupEngine {
    jobs: Arc<RwLock<HashMap<String, SureBackupJob>>>,
}

impl SureBackupEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a new verification job (the caller drives the actual recovery).
    pub async fn start_verification(
        &self,
        snapshot_id: &str,
        vm_name: &str,
    ) -> Result<SureBackupJob> {
        let job = SureBackupJob {
            id: uuid::Uuid::new_v4().to_string(),
            snapshot_id: snapshot_id.to_string(),
            vm_name: vm_name.to_string(),
            status: SureBackupStatus::Pending,
            test_results: Vec::new(),
            started_at: chrono::Utc::now().timestamp(),
            completed_at: None,
            tenant_id: None,
        };
        info!(
            "SureBackup job created: id={}, snapshot={}, vm={}",
            job.id, snapshot_id, vm_name
        );
        self.jobs.write().await.insert(job.id.clone(), job.clone());
        Ok(job)
    }

    /// Register a verification job stamped with the caller's tenant so the
    /// read paths can enforce isolation (SEC-019).
    pub async fn start_verification_for_tenant(
        &self,
        snapshot_id: &str,
        vm_name: &str,
        tenant_id: Option<String>,
    ) -> Result<SureBackupJob> {
        let job = SureBackupJob {
            id: uuid::Uuid::new_v4().to_string(),
            snapshot_id: snapshot_id.to_string(),
            vm_name: vm_name.to_string(),
            status: SureBackupStatus::Pending,
            test_results: Vec::new(),
            started_at: chrono::Utc::now().timestamp(),
            completed_at: None,
            tenant_id,
        };
        self.jobs.write().await.insert(job.id.clone(), job.clone());
        Ok(job)
    }

    /// Mutate a job in place.
    pub async fn update_job(
        &self,
        id: &str,
        f: impl FnOnce(&mut SureBackupJob),
    ) -> Option<SureBackupJob> {
        let mut jobs = self.jobs.write().await;
        let job = jobs.get_mut(id)?;
        f(job);
        Some(job.clone())
    }

    pub async fn get_job(&self, id: &str) -> Option<SureBackupJob> {
        self.jobs.read().await.get(id).cloned()
    }

    pub async fn get_status(&self) -> Vec<SureBackupJob> {
        let mut jobs: Vec<SureBackupJob> = self.jobs.read().await.values().cloned().collect();
        jobs.sort_by_key(|j| j.started_at);
        jobs
    }

    pub async fn cancel_job(&self, id: &str) -> Result<()> {
        let mut jobs = self.jobs.write().await;
        let job = jobs
            .get_mut(id)
            .ok_or_else(|| anyhow!("SureBackup job not found: {}", id))?;
        job.status = SureBackupStatus::Failed("cancelled by user".into());
        job.completed_at = Some(chrono::Utc::now().timestamp());
        Ok(())
    }

    /// Run a specific test against a restored VM.
    pub async fn run_test(&self, vm_ip: &str, test_type: &str) -> Result<TestResult> {
        let start = std::time::Instant::now();

        // vm_ip must be a literal IP: a leading '-' would be parsed by
        // ping/ssh as a flag (flag injection), and arbitrary hostnames would
        // let callers probe internal hosts through the daemon.
        let _ip: std::net::IpAddr = vm_ip
            .parse()
            .map_err(|_| anyhow!("vm_ip must be a literal IP address, got: {vm_ip}"))?;

        let result = match test_type {
            "ping" => {
                let (flag, count) = if cfg!(target_os = "windows") {
                    ("-n", "3")
                } else {
                    ("-c", "3")
                };
                let output = tokio::process::Command::new("ping")
                    .args([flag, count, vm_ip])
                    .output()
                    .await?;

                TestResult {
                    test_name: "Network connectivity".into(),
                    status: if output.status.success() { "pass" } else { "fail" }.into(),
                    message: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                    duration_seconds: start.elapsed().as_secs(),
                }
            }
            "heartbeat" => {
                // Probe TCP connectivity to the recovered VM. Defaults to the
                // SSH port; VM-specific ports can be added later per guest type.
                let outcome = tokio::net::TcpStream::connect((vm_ip, 22)).await;
                match outcome {
                    Ok(_) => TestResult {
                        test_name: "Guest heartbeat".into(),
                        status: "pass".into(),
                        message: format!("TCP port 22 reachable on {}", vm_ip),
                        duration_seconds: start.elapsed().as_secs(),
                    },
                    Err(e) => TestResult {
                        test_name: "Guest heartbeat".into(),
                        status: "fail".into(),
                        message: format!("TCP port 22 not reachable on {}: {}", vm_ip, e),
                        duration_seconds: start.elapsed().as_secs(),
                    },
                }
            }
            _ => TestResult {
                test_name: test_type.to_string(),
                status: "skipped".into(),
                message: "Unknown test type".into(),
                duration_seconds: 0,
            },
        };

        Ok(result)
    }
}
