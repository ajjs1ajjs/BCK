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

/// Single finished job recorded for report math.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportJobRecord {
    pub tenant_id: Option<String>,
    /// "success" | "failed"
    pub status: String,
    pub bytes: u64,
    pub duration_secs: u64,
    pub started_at: i64,
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
    history: Arc<RwLock<Vec<ReportJobRecord>>>,
}

impl ReportEngine {
    pub fn new() -> Self {
        Self {
            configs: Arc::new(RwLock::new(Vec::new())),
            history: Arc::new(RwLock::new(Vec::new())),
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

    /// Record a finished job so subsequent reports reflect real data.
    pub async fn record_job(&self, rec: ReportJobRecord) {
        let mut history = self.history.write().await;
        history.push(rec);
    }

    pub async fn generate_backup_summary(
        &self,
        tenant_id: Option<&str>,
        from: i64,
        to: i64,
    ) -> Result<ReportData> {
        let duration = to - from;
        let days = if duration > 0 { duration / 86400 } else { 1 };

        let jobs = self.jobs_in_range(tenant_id, from, to).await;
        let total_jobs = jobs.len() as u64;
        let successful = jobs.iter().filter(|j| j.status == "success").count() as u64;
        let failed = jobs.iter().filter(|j| j.status == "failed").count() as u64;
        let data_protected_bytes = jobs.iter().map(|j| j.bytes).sum::<u64>();
        let avg_duration = if total_jobs > 0 {
            jobs.iter().map(|j| j.duration_secs).sum::<u64>() as f64 / total_jobs as f64
        } else {
            0.0
        };

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
                "total_jobs": total_jobs,
                "successful": successful,
                "failed": failed,
                "data_protected_bytes": data_protected_bytes,
                "avg_duration_secs": avg_duration,
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
        tenant_id: Option<&str>,
        days: u32,
    ) -> Result<SlaCompliance> {
        let from = chrono::Utc::now().timestamp() - (days as i64 * 86400);
        let to = chrono::Utc::now().timestamp();

        let jobs = self.jobs_in_range(tenant_id, from, to).await;
        let total_jobs = jobs.len() as u64;
        let successful = jobs.iter().filter(|j| j.status == "success").count() as u64;
        let failed = jobs.iter().filter(|j| j.status == "failed").count() as u64;
        let sla_percentage = if total_jobs > 0 {
            successful as f64 / total_jobs as f64 * 100.0
        } else {
            100.0
        };
        let avg_duration_secs = if total_jobs > 0 {
            jobs.iter().map(|j| j.duration_secs).sum::<u64>() as f64 / total_jobs as f64
        } else {
            0.0
        };
        let total_data_protected = jobs.iter().map(|j| j.bytes).sum::<u64>();

        Ok(SlaCompliance {
            period: format!("last_{}_days", days),
            total_jobs,
            successful,
            failed,
            sla_percentage,
            avg_duration_secs,
            total_data_protected,
        })
    }

    pub async fn capacity_trend(
        &self,
        tenant_id: Option<&str>,
        months: u32,
    ) -> Result<Vec<CapacityPoint>> {
        use std::collections::BTreeMap;

        let now = chrono::Utc::now();
        let cutoff = now - chrono::Duration::days(months as i64 * 31);

        let history = self.history.read().await;
        let mut used_by_month: BTreeMap<String, u64> = BTreeMap::new();
        for job in history.iter() {
            if let Some(t) = tenant_id {
                if job.tenant_id.as_deref() != Some(t) {
                    continue;
                }
            }
            if job.started_at >= cutoff.timestamp() {
                let month = chrono::DateTime::<chrono::Utc>::from_timestamp(job.started_at, 0)
                    .map(|dt| dt.format("%Y-%m").to_string())
                    .unwrap_or_default();
                *used_by_month.entry(month).or_insert(0) += job.bytes;
            }
        }

        let total_capacity = 1024u64 * 1024 * 1024 * 1024;
        let mut points = Vec::new();
        let mut previous_used: Option<u64> = None;

        for i in (0..months).rev() {
            let dt = now - chrono::Duration::days(i as i64 * 30);
            let date = dt.format("%Y-%m").to_string();
            let used = used_by_month.get(&date).copied().unwrap_or(0);
            let growth = match previous_used {
                Some(prev) if used >= prev => (used - prev) as i64,
                Some(prev) => -(prev.saturating_sub(used) as i64),
                None => used as i64,
            };
            previous_used = Some(used);

            points.push(CapacityPoint {
                date,
                total_capacity,
                used,
                growth_bytes: growth,
            });
        }

        Ok(points)
    }

    pub async fn send_report(&self, config_id: &str, data: &ReportData) -> Result<()> {
        let config = {
            let configs = self.configs.read().await;
            configs.iter().find(|c| c.id == config_id).cloned()
        };
        let format = config.map(|c| c.format).unwrap_or(ReportFormat::Json);

        let json = serde_json::to_string_pretty(data)?;

        match format {
            ReportFormat::Json => {
                let path = std::env::temp_dir().join(format!("bck-report-{}.json", config_id));
                std::fs::write(&path, &json)?;
                info!("Report written (json): {}", path.display());
            }
            ReportFormat::Csv => {
                let path = std::env::temp_dir().join(format!("bck-report-{}.csv", config_id));
                std::fs::write(&path, summary_csv(data))?;
                info!("Report written (csv): {}", path.display());
            }
            ReportFormat::Html => {
                let path = std::env::temp_dir().join(format!("bck-report-{}.html", config_id));
                let escaped = json.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
                let html = format!(
                    "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><title>{}</title></head><body><h1>{}</h1><pre>{}</pre></body></html>",
                    data.title,
                    data.title,
                    escaped
                );
                std::fs::write(&path, html)?;
                info!("Report written (html): {}", path.display());
            }
            ReportFormat::Pdf => {
                // PDF rendering is not bundled; the data is persisted as JSON so
                // the report content is never lost.
                let path = std::env::temp_dir().join(format!("bck-report-{}.json", config_id));
                std::fs::write(&path, &json)?;
                info!(
                    "Report written (pdf requested; pdf rendering not bundled, wrote json): {}",
                    path.display()
                );
            }
        }

        Ok(())
    }

    pub async fn list_configs(&self) -> Vec<ReportConfig> {
        self.configs.read().await.clone()
    }

    /// Records filtered by tenant (if given) and started_at within [from, to].
    async fn jobs_in_range(
        &self,
        tenant_id: Option<&str>,
        from: i64,
        to: i64,
    ) -> Vec<ReportJobRecord> {
        let history = self.history.read().await;
        history
            .iter()
            .filter(|j| {
                if let Some(t) = tenant_id {
                    j.tenant_id.as_deref() == Some(t)
                } else {
                    true
                }
            })
            .filter(|j| j.started_at >= from && j.started_at <= to)
            .cloned()
            .collect()
    }
}

/// Flatten the Summary section into a two-column CSV (field, value).
fn summary_csv(data: &ReportData) -> String {
    let mut out = String::from("field,value\n");
    for section in &data.sections {
        if let Some(obj) = section.content.as_object() {
            for (k, v) in obj {
                let value = match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                out.push_str(&format!("{},{}\n", k, value));
            }
        }
    }
    out
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(tenant: &str, status: &str, bytes: u64, duration: u64, started_at: i64) -> ReportJobRecord {
        ReportJobRecord {
            tenant_id: Some(tenant.to_string()),
            status: status.to_string(),
            bytes,
            duration_secs: duration,
            started_at,
        }
    }

    #[tokio::test]
    async fn sla_math() {
        let engine = ReportEngine::new();
        let now = chrono::Utc::now().timestamp();
        let day = 86400i64;

        engine.record_job(rec("t1", "success", 100, 10, now - day * 2)).await;
        engine.record_job(rec("t1", "success", 200, 20, now - day)).await;
        engine.record_job(rec("t1", "failed", 50, 30, now)).await;
        // Different tenant should be excluded.
        engine.record_job(rec("t2", "failed", 999, 5, now)).await;

        let sla = engine.calculate_sla(Some("t1"), 7).await.unwrap();
        assert_eq!(sla.total_jobs, 3);
        assert_eq!(sla.successful, 2);
        assert_eq!(sla.failed, 1);
        assert!((sla.sla_percentage - 200.0 / 3.0).abs() < 1e-9);
        assert!((sla.avg_duration_secs - 20.0).abs() < 1e-9);
        assert_eq!(sla.total_data_protected, 350);

        // A tenant with no jobs reports 100% SLA with zero totals.
        let none = engine.calculate_sla(Some("ghost"), 7).await.unwrap();
        assert_eq!(none.total_jobs, 0);
        assert_eq!(none.successful, 0);
        assert_eq!(none.failed, 0);
        assert_eq!(none.sla_percentage, 100.0);
    }

    #[tokio::test]
    async fn summary_math() {
        let engine = ReportEngine::new();
        let now = chrono::Utc::now().timestamp();
        let day = 86400i64;

        engine.record_job(rec("t1", "success", 100, 10, now - day * 3)).await;
        engine.record_job(rec("t1", "success", 200, 20, now - day * 2)).await;
        engine.record_job(rec("t1", "failed", 50, 30, now - day)).await;
        // Out of range.
        engine.record_job(rec("t1", "success", 999, 1, now - day * 10)).await;
        // Different tenant.
        engine.record_job(rec("t2", "success", 777, 2, now)).await;

        let from = now - day * 7;
        let to = now;
        let data = engine.generate_backup_summary(Some("t1"), from, to).await.unwrap();

        let summary = data.sections.iter().find(|s| s.heading == "Summary").unwrap();
        let c = summary.content.as_object().unwrap();
        assert_eq!(c["total_jobs"], 3);
        assert_eq!(c["successful"], 2);
        assert_eq!(c["failed"], 1);
        assert_eq!(c["data_protected_bytes"], 350);
        assert_eq!(c["dedup_ratio"], 1.0);
        assert_eq!(c["compression_ratio"], 1.0);
        assert!((c["avg_duration_secs"].as_f64().unwrap() - 20.0).abs() < 1e-9);

        // Tenant-agnostic summary includes both tenants in window.
        let all = engine.generate_backup_summary(None, from, to).await.unwrap();
        let s2 = all.sections.iter().find(|s| s.heading == "Summary").unwrap();
        assert_eq!(s2.content["total_jobs"], 4);
        assert_eq!(s2.content["data_protected_bytes"], 1127);
    }

    #[test]
    fn summary_csv_has_header_and_values() {
        let data = ReportData {
            title: "t".into(),
            generated_at: 0,
            sections: vec![ReportSection {
                heading: "Summary".into(),
                content: serde_json::json!({
                    "total_jobs": 5,
                    "successful": 4,
                }),
            }],
        };
        let csv = summary_csv(&data);
        assert!(csv.starts_with("field,value\n"));
        assert!(csv.contains("total_jobs,5"));
        assert!(csv.contains("successful,4"));
    }
}
