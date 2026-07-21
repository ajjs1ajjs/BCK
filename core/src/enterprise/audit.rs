use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub timestamp: i64,
    pub user_id: String,
    pub tenant_id: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: String,
    pub details: serde_json::Value,
    pub ip_address: String,
    pub user_agent: String,
    pub outcome: AuditOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AuditOutcome {
    Success,
    Failure(String),
    Denied,
}

/// Audit logger — records all operations for compliance
pub struct AuditLogger {
    events: Arc<RwLock<Vec<AuditEvent>>>,
    log_path: Option<String>,
}

impl AuditLogger {
    pub fn new() -> Self {
        Self {
            events: Arc::new(RwLock::new(Vec::new())),
            log_path: None,
        }
    }

    pub fn with_log_path(path: &str) -> Self {
        Self {
            events: Arc::new(RwLock::new(Vec::new())),
            log_path: Some(path.to_string()),
        }
    }

    pub async fn log(&self, event: AuditEvent) -> Result<()> {
        let mut events = self.events.write().await;
        let event = AuditEvent {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
            ..event
        };

        info!("AUDIT: user={} action={} resource={}/{} outcome={:?}",
            event.user_id, event.action, event.resource_type, event.resource_id, event.outcome);

        if let Some(ref path) = self.log_path {
            if let Ok(json) = serde_json::to_string(&event) {
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                {
                    let _ = writeln!(file, "{}", json);
                }
            }
        }

        events.push(event);

        let overflow = events.len().saturating_sub(10_000);
        if overflow > 0 {
            events.drain(0..overflow);
        }

        Ok(())
    }

    pub async fn query(
        &self,
        _user_id: Option<&str>,
        _action: Option<&str>,
        _resource_type: Option<&str>,
        _from: Option<i64>,
        _to: Option<i64>,
        _limit: usize,
    ) -> Vec<AuditEvent> {
        let events = self.events.read().await;
        events.iter().rev().take(_limit).cloned().collect()
    }

    pub async fn log_access(
        &self,
        user_id: &str,
        tenant_id: Option<&str>,
        resource_type: &str,
        resource_id: &str,
        ip: &str,
    ) -> Result<()> {
        self.log(AuditEvent {
            id: String::new(),
            timestamp: 0,
            user_id: user_id.to_string(),
            tenant_id: tenant_id.map(String::from),
            action: "access".into(),
            resource_type: resource_type.to_string(),
            resource_id: resource_id.to_string(),
            details: serde_json::json!({}),
            ip_address: ip.to_string(),
            user_agent: String::new(),
            outcome: AuditOutcome::Success,
        }).await
    }

    pub async fn log_failure(
        &self,
        user_id: &str,
        action: &str,
        resource: &str,
        reason: &str,
    ) -> Result<()> {
        self.log(AuditEvent {
            id: String::new(),
            timestamp: 0,
            user_id: user_id.to_string(),
            tenant_id: None,
            action: action.to_string(),
            resource_type: "system".into(),
            resource_id: resource.to_string(),
            details: serde_json::json!({"reason": reason}),
            ip_address: String::new(),
            user_agent: String::new(),
            outcome: AuditOutcome::Failure(reason.to_string()),
        }).await
    }

    pub async fn export(&self, _from: i64, _to: i64, format: &str) -> Result<Vec<u8>> {
        let events = self.events.read().await;
        match format {
            "json" => Ok(serde_json::to_vec_pretty(&*events)?),
            _ => Ok(serde_json::to_vec(&*events)?),
        }
    }

    pub async fn purge_old(&self, retention_days: u32) -> Result<u64> {
        let cutoff = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64 - (retention_days as i64 * 86400))
            .unwrap_or(0);

        let mut events = self.events.write().await;
        let before = events.len();
        events.retain(|e| e.timestamp >= cutoff);
        let purged = (before - events.len()) as u64;

        info!("Audit purged {} entries older than {} days", purged, retention_days);
        Ok(purged)
    }
}
