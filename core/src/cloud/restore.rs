//! Cloud restore orchestration: submit restore operations against registered
//! cloud accounts and track their status. Provider connectors are dispatched
//! per provider; when the account lacks the required credentials the operation
//! is recorded as "Planned" (simulated) so the UI/CLI remain functional.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use super::{CloudAccount, CloudProvider};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CloudRestoreStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Planned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudRestore {
    #[serde(default)]
    pub id: String,
    pub account_id: String,
    pub provider: CloudProvider,
    pub resource_type: String,
    pub resource_id: String,
    pub target_name: String,
    pub status: CloudRestoreStatus,
    pub requested_at: i64,
    #[serde(default)]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreRequest {
    pub resource_type: String,
    pub resource_id: String,
    pub target_name: String,
    #[serde(default)]
    pub params: HashMap<String, String>,
}

/// Restorable resource kinds exposed per provider for the UI dropdowns.
pub struct RestorableKind {
    pub resource_type: String,
    pub label: String,
}

pub fn restorable_kinds(provider: &CloudProvider) -> Vec<RestorableKind> {
    match provider {
        CloudProvider::Aws => vec![
            RestorableKind { resource_type: "ec2_ami".into(), label: "EC2 instance (AMI)".into() },
            RestorableKind { resource_type: "ebs_snapshot".into(), label: "EBS volume snapshot".into() },
            RestorableKind { resource_type: "rds_snapshot".into(), label: "RDS database snapshot".into() },
        ],
        CloudProvider::Azure => vec![
            RestorableKind { resource_type: "vm_restore_point".into(), label: "VM restore point".into() },
        ],
        CloudProvider::Gcp => vec![
            RestorableKind { resource_type: "gce_image".into(), label: "GCE instance image".into() },
        ],
    }
}

pub struct CloudRestoreManager {
    restores: Arc<RwLock<Vec<CloudRestore>>>,
}

impl CloudRestoreManager {
    pub fn new() -> Self {
        Self {
            restores: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn list(&self) -> Vec<CloudRestore> {
        self.restores.read().await.clone()
    }

    pub async fn list_for_account(&self, account_id: &str) -> Vec<CloudRestore> {
        self.restores.read().await.iter()
            .filter(|r| r.account_id == account_id)
            .cloned()
            .collect()
    }

    pub async fn get(&self, id: &str) -> Option<CloudRestore> {
        self.restores.read().await.iter()
            .find(|r| r.id == id)
            .cloned()
    }

    /// Submit a restore operation for an account. Returns the recorded
    /// operation (status reflects dispatch outcome).
    pub async fn submit(
        &self,
        account: &CloudAccount,
        req: RestoreRequest,
    ) -> Result<CloudRestore> {
        if req.resource_id.is_empty() || req.target_name.is_empty() {
            return Err(anyhow!("resource_id and target_name are required"));
        }
        let kinds = restorable_kinds(&account.provider);
        if !kinds.iter().any(|k| k.resource_type == req.resource_type) {
            return Err(anyhow!(
                "unsupported resource type '{}' for provider {:?}",
                req.resource_type,
                account.provider
            ));
        }

        let restore = CloudRestore {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: account.id.clone(),
            provider: account.provider.clone(),
            resource_type: req.resource_type.clone(),
            resource_id: req.resource_id.clone(),
            target_name: req.target_name.clone(),
            status: CloudRestoreStatus::InProgress,
            requested_at: chrono::Utc::now().timestamp(),
            completed_at: None,
            result: None,
            error: None,
        };
        info!(
            "Cloud restore submitted: account={} type={} resource={} target={}",
            account.name, req.resource_type, req.resource_id, req.target_name
        );

        let outcome = run_provider_restore(account, &req).await;
        let restore = match outcome {
            Ok(result) => CloudRestore {
                status: CloudRestoreStatus::Completed,
                completed_at: Some(chrono::Utc::now().timestamp()),
                result: Some(result),
                ..restore
            },
            Err(e) => {
                let msg = e.to_string();
                if is_missing_credentials(&account, &req, &msg) {
                    info!("Cloud restore planned (no credentials configured): {}", msg);
                    CloudRestore {
                        status: CloudRestoreStatus::Planned,
                        completed_at: Some(chrono::Utc::now().timestamp()),
                        error: Some(msg),
                        ..restore
                    }
                } else {
                    CloudRestore {
                        status: CloudRestoreStatus::Failed,
                        completed_at: Some(chrono::Utc::now().timestamp()),
                        error: Some(msg),
                        ..restore
                    }
                }
            }
        };

        self.restores.write().await.push(restore.clone());
        Ok(restore)
    }
}

/// Dispatch to the provider-specific restore connector. Connectors construct
/// clients from the account (or env) credentials, so without credentials they
/// return a descriptive error that `submit` maps to a "Planned" status.
async fn run_provider_restore(
    account: &CloudAccount,
    req: &RestoreRequest,
) -> Result<String> {
    match account.provider {
        CloudProvider::Aws => {
            let connector = crate::cloud::aws::AwsConnector::new(account.clone());
            let session = connector.authenticate().await?;
            match req.resource_type.as_str() {
                "ec2_ami" => {
                    let engine = crate::cloud::aws::ec2::Ec2Backup::new_with(session);
                    engine.restore_from_ami(&req.resource_id, &req.target_name).await
                }
                "ebs_snapshot" => {
                    let engine = crate::cloud::aws::ebs::EbsSnapshotManager::new_with(session);
                    engine.restore_volume(&req.resource_id, &req.target_name).await
                }
                "rds_snapshot" => {
                    let engine = crate::cloud::aws::rds::RdsBackup::new_with(session);
                    engine.restore_from_snapshot(&req.resource_id, &req.target_name).await
                }
                _ => Err(anyhow!("unsupported AWS resource type: {}", req.resource_type)),
            }
        }
        CloudProvider::Azure => {
            let subscription_id = req
                .params
                .get("subscription_id")
                .ok_or_else(|| anyhow!("Azure subscription_id param is required"))?
                .clone();
            let resource_group = req
                .params
                .get("resource_group")
                .ok_or_else(|| anyhow!("Azure resource_group param is required"))?
                .clone();
            let tenant_id = account.tenant_id.clone()
                .ok_or_else(|| anyhow!("Azure tenant_id not configured"))?;
            let client_id = account.client_id.clone()
                .ok_or_else(|| anyhow!("Azure client_id not configured"))?;
            let client_secret = account.client_secret.clone()
                .ok_or_else(|| anyhow!("Azure client_secret not configured"))?;
            match req.resource_type.as_str() {
                "vm_restore_point" => {
                    let engine = crate::cloud::azure::vm::AzureVmBackup::new(
                        subscription_id,
                        resource_group,
                        tenant_id,
                        client_id,
                        client_secret,
                    );
                    engine.restore_vm(&req.resource_id, &req.target_name).await?;
                    Ok(format!("restore initiated for {}", req.target_name))
                }
                _ => Err(anyhow!("unsupported Azure resource type: {}", req.resource_type)),
            }
        }
        CloudProvider::Gcp => {
            let project_id = account.project_id.clone()
                .ok_or_else(|| anyhow!("GCP project_id not configured"))?;
            match req.resource_type.as_str() {
                "gce_image" => {
                    let zone = req
                        .params
                        .get("zone")
                        .cloned()
                        .or_else(|| std::env::var("GCP_ZONE").ok())
                        .ok_or_else(|| anyhow!("GCP zone param is required"))?;
                    let engine = crate::cloud::gcp::gce::GceBackup::new(project_id, zone);
                    engine.restore_from_image(&req.resource_id, &req.target_name).await
                }
                _ => Err(anyhow!("unsupported GCP resource type: {}", req.resource_type)),
            }
        }
    }
}

/// Heuristic: an error message that indicates missing credentials/configuration
/// means the connector could not run, so the operation is recorded as Planned.
fn is_missing_credentials(account: &CloudAccount, req: &RestoreRequest, msg: &str) -> bool {
    let hints = [
        "not configured",
        "not set",
        "required",
        "missing",
        "credentials",
        "access key",
        "secret key",
    ];
    if hints.iter().any(|h| msg.contains(h)) {
        return true;
    }
    match account.provider {
        CloudProvider::Aws => {
            account.access_key.is_none()
                && req.resource_type != "ec2_ami"
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aws_account() -> CloudAccount {
        CloudAccount {
            id: "acc-1".into(),
            name: "prod".into(),
            provider: CloudProvider::Aws,
            auth_type: "access_key".into(),
            region: "us-east-1".into(),
            status: super::super::AccountStatus::Connected,
            access_key: None,
            secret_key: None,
            session_token: None,
            tenant_id: None,
            client_id: None,
            client_secret: None,
            project_id: None,
        }
    }

    #[tokio::test]
    async fn submit_unsupported_type_rejected() {
        let mgr = CloudRestoreManager::new();
        let err = mgr
            .submit(&aws_account(), RestoreRequest {
                resource_type: "nope".into(),
                resource_id: "snap-1".into(),
                target_name: "restored".into(),
                params: HashMap::new(),
            })
            .await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn submit_without_credentials_is_planned() {
        let mgr = CloudRestoreManager::new();
        let restore = mgr
            .submit(&aws_account(), RestoreRequest {
                resource_type: "ebs_snapshot".into(),
                resource_id: "snap-1".into(),
                target_name: "us-east-1a".into(),
                params: HashMap::new(),
            })
            .await
            .unwrap();
        assert_eq!(restore.status, CloudRestoreStatus::Planned);
        assert_eq!(mgr.list().await.len(), 1);
        assert_eq!(mgr.list_for_account("acc-1").await.len(), 1);
        assert!(mgr.get(&restore.id).await.is_some());
    }

    #[test]
    fn restorable_kinds_per_provider() {
        assert_eq!(restorable_kinds(&CloudProvider::Aws).len(), 3);
        assert_eq!(restorable_kinds(&CloudProvider::Azure).len(), 1);
        assert_eq!(restorable_kinds(&CloudProvider::Gcp).len(), 1);
    }
}
