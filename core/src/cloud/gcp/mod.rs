pub mod gce;
pub mod disks;
pub mod sql;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::CloudAccount;

/// GCP connector — manages GCE, Persistent Disk, and Cloud SQL backups
pub struct GcpConnector {
    account: CloudAccount,
}

impl GcpConnector {
    pub fn new(account: CloudAccount) -> Self {
        Self { account }
    }

    /// Authenticate with GCP using service account
    pub async fn authenticate(&self) -> Result<GcpSession> {
        info!("Authenticating with GCP: region={}", self.account.region);
        Ok(GcpSession {
            project_id: String::new(),
            region: self.account.region.clone(),
        })
    }

    /// List all GCE instances
    pub async fn list_instances(&self) -> Result<Vec<GceInstance>> {
        // compute.instances.list
        Ok(Vec::new())
    }
}

pub struct GcpSession {
    pub project_id: String,
    pub region: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GceInstance {
    pub id: String,
    pub name: String,
    pub zone: String,
    pub machine_type: String,
    pub disks: Vec<String>,
}
