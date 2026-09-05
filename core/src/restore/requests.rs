//! Self-service restore requests: users submit restore requests, approvers
//! (admins / operators) review and approve or reject them.

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RestoreRequestStatus {
    Pending,
    Approved,
    Rejected,
    Cancelled,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreRequest {
    #[serde(default)]
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub snapshot_id: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub target_path: String,
    #[serde(default)]
    pub reason: String,
    pub status: RestoreRequestStatus,
    pub requested_at: i64,
    #[serde(default)]
    pub decided_at: Option<i64>,
    #[serde(default)]
    pub decided_by: Option<String>,
    #[serde(default)]
    pub decision_note: Option<String>,
}

/// Self-service restore request manager.
pub struct RestoreRequestManager {
    requests: Arc<RwLock<Vec<RestoreRequest>>>,
}

impl RestoreRequestManager {
    pub fn new() -> Self {
        Self {
            requests: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Submit a new restore request (always starts as Pending).
    pub async fn submit(
        &self,
        user_id: &str,
        username: &str,
        snapshot_id: &str,
        files: Vec<String>,
        target_path: &str,
        reason: &str,
    ) -> Result<RestoreRequest> {
        if snapshot_id.is_empty() || target_path.is_empty() {
            return Err(anyhow!("snapshot_id and target_path are required"));
        }
        let request = RestoreRequest {
            id: uuid::Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            username: username.to_string(),
            snapshot_id: snapshot_id.to_string(),
            files,
            target_path: target_path.to_string(),
            reason: reason.to_string(),
            status: RestoreRequestStatus::Pending,
            requested_at: chrono::Utc::now().timestamp(),
            decided_at: None,
            decided_by: None,
            decision_note: None,
        };
        self.requests.write().await.push(request.clone());
        info!(
            "Restore request submitted: id={}, user={}, snapshot={}",
            request.id, username, snapshot_id
        );
        Ok(request)
    }

    /// List the requests submitted by one user.
    pub async fn list_for_user(&self, user_id: &str) -> Vec<RestoreRequest> {
        self.requests.read().await.iter()
            .filter(|r| r.user_id == user_id)
            .cloned()
            .collect()
    }

    /// List all requests (approvers).
    pub async fn list_all(&self) -> Vec<RestoreRequest> {
        self.requests.read().await.clone()
    }

    /// Get a request by id.
    pub async fn get(&self, id: &str) -> Option<RestoreRequest> {
        self.requests.read().await.iter()
            .find(|r| r.id == id)
            .cloned()
    }

    /// Approve a pending request.
    pub async fn approve(&self, id: &str, decided_by: &str, note: &str) -> Result<bool> {
        self.decide(id, RestoreRequestStatus::Approved, decided_by, note).await
    }

    /// Reject a pending request.
    pub async fn reject(&self, id: &str, decided_by: &str, note: &str) -> Result<bool> {
        self.decide(id, RestoreRequestStatus::Rejected, decided_by, note).await
    }

    /// Cancel a pending request (by the submitter or an approver).
    pub async fn cancel(&self, id: &str) -> Result<bool> {
        let mut requests = self.requests.write().await;
        match requests.iter_mut().find(|r| r.id == id) {
            Some(r) if r.status == RestoreRequestStatus::Pending => {
                r.status = RestoreRequestStatus::Cancelled;
                info!("Restore request cancelled: {}", id);
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// Mark an approved request as completed (after the restore ran).
    pub async fn complete(&self, id: &str) -> Result<bool> {
        let mut requests = self.requests.write().await;
        match requests.iter_mut().find(|r| r.id == id) {
            Some(r) if r.status == RestoreRequestStatus::Approved => {
                r.status = RestoreRequestStatus::Completed;
                info!("Restore request completed: {}", id);
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    async fn decide(
        &self,
        id: &str,
        status: RestoreRequestStatus,
        decided_by: &str,
        note: &str,
    ) -> Result<bool> {
        let mut requests = self.requests.write().await;
        match requests.iter_mut().find(|r| r.id == id) {
            Some(r) if r.status == RestoreRequestStatus::Pending => {
                info!("Restore request {} decided by {}: {:?}", id, decided_by, status);
                r.status = status;
                r.decided_at = Some(chrono::Utc::now().timestamp());
                r.decided_by = Some(decided_by.to_string());
                if !note.is_empty() {
                    r.decision_note = Some(note.to_string());
                }
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}
