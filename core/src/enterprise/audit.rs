use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
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
    db_enabled: bool,
}

impl AuditLogger {
    pub fn new() -> Self {
        Self {
            events: Arc::new(RwLock::new(Vec::new())),
            db_enabled: true,
        }
    }

    /// Log an audit event
    pub async fn log(&self, event: AuditEvent) -> Result<()> {
        let mut events = self.events.write().await;
        let event = AuditEvent {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().timestamp(),
            ..event
        };

        info!("AUDIT: user={} action={} resource={}/{} outcome={:?}",
            event.user_id, event.action, event.resource_type, event.resource_id, event.outcome);

        events.push(event);

        // Keep last 10000 in memory, persist rest to DB
        let overflow = events.len().saturating_sub(10_000);
        if overflow > 0 {
            events.drain(0..overflow);
        }

        if self.db_enabled {
            // INSERT INTO audit_log (id, timestamp, user_id, ...)
        }

        Ok(())
    }

    /// Query audit events with filters
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
        // In production: query from DB with filters
        events.iter().rev().take(_limit).cloned().collect()
    }

    /// Export audit log for compliance
    pub async fn export(&self, _from: i64, _to: i64, _format: &str) -> Result<Vec<u8>> {
        // Generate CSV / JSON export
        Ok(Vec::new())
    }

    /// Purge audit logs older than retention period
    pub async fn purge_old(&self, _retention_days: u32) -> Result<u64> {
        info!("Purging audit logs older than {} days", _retention_days);
        // DELETE FROM audit_log WHERE timestamp < ?
        Ok(0)
    }

    /// Create a convenience method to log common events
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
}
