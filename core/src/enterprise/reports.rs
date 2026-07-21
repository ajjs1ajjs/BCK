use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportConfig {
    pub id: String,
    pub name: String,
    pub report_type: ReportType,
    pub schedule: String,
    pub recipients: Vec<String>,
    pub format: ReportFormat,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ReportType {
    BackupSummary,
    DailyStatus,
    WeeklySlaCompliance,
    MonthlyCapacity,
    AuditLog,
    FailedJobs,
    StorageTrend,
    VmProtectionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ReportFormat {
    Pdf,
    Csv,
    Html,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlaCompliance {
    pub period: String,
    pub total_jobs: u64,
    pub successful: u64,
    pub failed: u64,
    pub sla_percentage: f64,
    pub avg_duration_secs: f64,
    pub total_data_protected: u64,
}

pub struct ReportEngine {
    configs: Arc<RwLock<Vec<ReportConfig>>>,
}

impl ReportEngine {
    pub fn new() -> Self {
        Self {
            configs: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn create_config(&self, config: ReportConfig) -> Result<ReportConfig> {
        let mut configs = self.configs.write().await;
        let config = ReportConfig {
            id: uuid::Uuid::new_v4().to_string(),
            ..config
        };
        info!("Report config created: {} ({:?})", config.name, config.report_type);
        configs.push(config.clone());
        Ok(config)
    }

    pub async fn generate_backup_summary(
        &self,
        _tenant_id: Option<&str>,
        from: i64,
        to: i64,
    ) -> Result<ReportData> {
        let duration = to - from;
        let days = if duration > 0 { duration / 86400 } else { 1 };

        let mut sections = Vec::new();

        sections.push(ReportSection {
            heading: "Period".into(),
            content: serde_json::json!({
                "from": from,
                "to": to,
                "days": days,
            }),
        });

        sections.push(ReportSection {
            heading: "Summary".into(),
            content: serde_json::json!({
                "total_jobs": 0,
                "successful": 0,
                "failed": 0,
                "data_protected_bytes": 0,
                "dedup_ratio": 1.0,
                "compression_ratio": 1.0,
            }),
        });

        Ok(ReportData {
            title: format!("Backup Summary (last {} days)", days),
            generated_at: chrono::Utc::now().timestamp(),
            sections,
        })
    }

    pub async fn calculate_sla(
        &self,
        _tenant_id: Option<&str>,
        days: u32,
    ) -> Result<SlaCompliance> {
        Ok(SlaCompliance {
            period: format!("last_{}_days", days),
            total_jobs: 0,
            successful: 0,
            failed: 0,
            sla_percentage: 100.0,
            avg_duration_secs: 0.0,
            total_data_protected: 0,
        })
    }

    pub async fn capacity_trend(
        &self,
        _tenant_id: Option<&str>,
        months: u32,
    ) -> Result<Vec<CapacityPoint>> {
        let mut points = Vec::new();
        let now = chrono::Utc::now();

        for i in (0..months).rev() {
            let dt = now - chrono::Duration::days(i as i64 * 30);
            points.push(CapacityPoint {
                date: dt.format("%Y-%m").to_string(),
                total_capacity: 1024u64 * 1024 * 1024 * 1024,
                used: (i as u64) * 50_000_000_000,
                growth_bytes: 50_000_000_000i64,
            });
        }

        Ok(points)
    }

    pub async fn send_report(&self, _config_id: &str, data: &ReportData) -> Result<()> {
        let json = serde_json::to_string_pretty(data)?;
        info!("Report generated ({} bytes): {}", json.len(), data.title);
        Ok(())
    }

    pub async fn list_configs(&self) -> Vec<ReportConfig> {
        self.configs.read().await.clone()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportData {
    pub title: String,
    pub generated_at: i64,
    pub sections: Vec<ReportSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSection {
    pub heading: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapacityPoint {
    pub date: String,
    pub total_capacity: u64,
    pub used: u64,
    pub growth_bytes: i64,
}
