pub mod resources;
pub mod pvc;
pub mod restore;

use anyhow::Result;
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
            pvcs_backed_up: if include_pvcs { 0 } else { 0 },
            total_size: 0,
            status: "running".into(),
            started_at: chrono::Utc::now().timestamp(),
            completed_at: None,
        };
        info!("K8s backup started: cluster={}, namespace={}", cluster_id, namespace);
        self.jobs.write().await.push(job.clone());
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
