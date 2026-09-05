pub mod resources;
pub mod pvc;
pub mod restore;

use crate::cloud::k8s::pvc::PvcBackup;
use crate::cloud::k8s::resources::K8sResourceBackup;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sCluster {
    pub id: String,
    pub name: String,
    pub context: String,
    pub api_server: String,
    pub auth_type: K8sAuthType,
    pub namespaces: Vec<String>,
    pub status: K8sClusterStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum K8sAuthType {
    Kubeconfig,
    Token,
    Oidc,
    AwsEks,
    AzureAks,
    GcpGke,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum K8sClusterStatus {
    Connected,
    Disconnected,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sBackupJob {
    pub id: String,
    pub cluster_id: String,
    pub resources_backed_up: u64,
    pub pvcs_backed_up: u64,
    pub total_size: u64,
    pub status: String,
    pub started_at: i64,
    pub completed_at: Option<i64>,
}

/// Kubernetes backup manager — backs up cluster resources and PVC data
pub struct K8sBackupManager {
    clusters: Arc<RwLock<Vec<K8sCluster>>>,
    jobs: Arc<RwLock<Vec<K8sBackupJob>>>,
}

struct BackupStats {
    resources: u64,
    pvcs: u64,
    size: u64,
}

impl K8sBackupManager {
    pub fn new() -> Self {
        Self {
            clusters: Arc::new(RwLock::new(Vec::new())),
            jobs: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Register a K8s cluster
    pub async fn register_cluster(&self, cluster: K8sCluster) -> Result<K8sCluster> {
        let mut clusters = self.clusters.write().await;
        let cluster = K8sCluster {
            id: uuid::Uuid::new_v4().to_string(),
            ..cluster
        };
        info!("K8s cluster registered: {} ({})", cluster.name, cluster.api_server);
        clusters.push(cluster.clone());
        Ok(cluster)
    }

    /// Backup a namespace (resources + PVCs)
    pub async fn backup_namespace(
        &self,
        cluster_id: &str,
        namespace: &str,
        include_pvcs: bool,
    ) -> Result<K8sBackupJob> {
        let job = K8sBackupJob {
            id: uuid::Uuid::new_v4().to_string(),
            cluster_id: cluster_id.to_string(),
            resources_backed_up: 0,
            pvcs_backed_up: 0,
            total_size: 0,
            status: "running".into(),
            started_at: chrono::Utc::now().timestamp(),
            completed_at: None,
        };
        info!("K8s backup started: cluster={}, namespace={}", cluster_id, namespace);

        {
            let mut jobs = self.jobs.write().await;
            jobs.push(job.clone());
        }

        let cluster = {
            let clusters = self.clusters.read().await;
            clusters.iter().find(|c| c.id == cluster_id).cloned()
        };

        let Some(cluster) = cluster else {
            let mut jobs = self.jobs.write().await;
            if let Some(j) = jobs.iter_mut().find(|j| j.id == job.id) {
                j.status = "failed: cluster not found".into();
                j.completed_at = Some(chrono::Utc::now().timestamp());
            }
            return Ok(job);
        };

        let context = cluster.context.clone();
        let jobs = self.jobs.clone();
        let namespace = namespace.to_string();
        let job_for_task = job.clone();

        tokio::spawn(async move {
            let stats = run_backup(&context, &namespace, include_pvcs, &job_for_task).await;
            let mut jobs = jobs.write().await;
            if let Some(j) = jobs.iter_mut().find(|j| j.id == job_for_task.id) {
                match stats {
                    Ok(s) => {
                        j.resources_backed_up = s.resources;
                        j.pvcs_backed_up = s.pvcs;
                        j.total_size = s.size;
                        j.status = "completed".into();
                        j.completed_at = Some(chrono::Utc::now().timestamp());
                    }
                    Err(e) => {
                        j.status = format!("failed: {}", e);
                        j.completed_at = Some(chrono::Utc::now().timestamp());
                    }
                }
            }
        });

        Ok(job)
    }

    /// List clusters
    pub async fn list_clusters(&self) -> Vec<K8sCluster> {
        self.clusters.read().await.clone()
    }

    /// List backup jobs
    pub async fn list_jobs(&self) -> Vec<K8sBackupJob> {
        self.jobs.read().await.clone()
    }
}

/// Run the actual backup: export resources to JSON, snapshot PVCs.
async fn run_backup(
    context: &str,
    namespace: &str,
    include_pvcs: bool,
    job: &K8sBackupJob,
) -> Result<BackupStats> {
    let resource_backup = K8sResourceBackup::new_with_context(context);
    let manifest = resource_backup.backup_resources(namespace, &[]).await?;

    let backup_dir = std::env::temp_dir().join("bck-k8s").join(&job.id);
    tokio::fs::create_dir_all(&backup_dir)
        .await
        .with_context(|| format!("failed to create backup dir {}", backup_dir.display()))?;
    let json = serde_json::to_vec_pretty(&manifest).context("failed to serialize manifest")?;
    tokio::fs::write(backup_dir.join("resources.json"), &json)
        .await
        .context("failed to write resources.json")?;
    let total_size = json.len() as u64;

    let mut pvcs_backed_up = 0u64;
    if include_pvcs {
        let pvc_backup = PvcBackup::new_with_context(context);
        let pvcs = pvc_backup.list_pvcs(namespace).await?;
        info!("Snapshoting {} PVCs in namespace {}", pvcs.len(), namespace);
        for pvc in &pvcs {
            let snapshot_name = format!("bck-{}-{}", job.id, pvc);
            pvc_backup.snapshot_pvc(namespace, pvc, &snapshot_name).await?;
            pvcs_backed_up += 1;
        }
    }

    Ok(BackupStats {
        resources: manifest.items.len() as u64,
        pvcs: pvcs_backed_up,
        size: total_size,
    })
}
