use anyhow::{Result, anyhow};
use tracing::info;

use crate::cloud::aws::client::{parse_xml_tree, AwsClient, AwsSession};

/// RDS database backup
pub struct RdsBackup {
    client: AwsClient,
}

impl RdsBackup {
    pub fn new() -> Self {
        let client = AwsClient::from_env().unwrap_or_else(|_| AwsClient::new(AwsSession::default()));
        Self { client }
    }

    pub fn new_with(session: AwsSession) -> Self {
        Self {
            client: AwsClient::new(session),
        }
    }

    /// Create a manual snapshot of an RDS instance, returning the snapshot identifier.
    pub async fn create_snapshot(&self, db_instance_id: &str, snapshot_name: &str) -> Result<String> {
        info!("Creating RDS snapshot for: {db_instance_id}");
        let endpoint = format!("rds.{}.amazonaws.com", self.client.region());
        let body = self
            .client
            .query(
                &endpoint,
                "rds",
                &[
                    ("Action", "CreateDBSnapshot"),
                    ("Version", "2014-10-31"),
                    ("DBSnapshotIdentifier", snapshot_name),
                    ("DBInstanceIdentifier", db_instance_id),
                ],
            )
            .await?;
        parse_create_db_snapshot_xml(&body)
    }

    /// Restore an RDS instance from a snapshot, returning the new instance identifier.
    pub async fn restore_from_snapshot(
        &self,
        snapshot_id: &str,
        new_instance_id: &str,
    ) -> Result<String> {
        info!("Restoring RDS from snapshot: {snapshot_id}");
        let endpoint = format!("rds.{}.amazonaws.com", self.client.region());
        let body = self
            .client
            .query(
                &endpoint,
                "rds",
                &[
                    ("Action", "RestoreDBInstanceFromDBSnapshot"),
                    ("Version", "2014-10-31"),
                    ("DBInstanceIdentifier", new_instance_id),
                    ("DBSnapshotIdentifier", snapshot_id),
                ],
            )
            .await?;
        parse_restore_db_instance_xml(&body)
    }

    /// Export a snapshot to S3 for long-term retention (best-effort).
    pub async fn export_to_s3(&self, snapshot_id: &str, s3_bucket: &str) -> Result<()> {
        info!("Exporting RDS snapshot to S3: {}/{}", s3_bucket, snapshot_id);
        // Fail fast instead of silently using placeholder credentials that
        // would export to the wrong account or fail obscurely.
        let account_id = std::env::var("BCK_RDS_EXPORT_ACCOUNT_ID")
            .map_err(|_| anyhow!("BCK_RDS_EXPORT_ACCOUNT_ID is required for RDS export"))?;
        let source_arn = format!(
            "arn:aws:rds:{}:{}:snapshot:{}",
            self.client.region(),
            account_id,
            snapshot_id
        );
        let export_id = format!("bck-{snapshot_id}");
        let role_arn = std::env::var("BCK_RDS_EXPORT_ROLE_ARN")
            .map_err(|_| anyhow!("BCK_RDS_EXPORT_ROLE_ARN is required for RDS export"))?;
        let kms_key_id = std::env::var("BCK_RDS_EXPORT_KMS_KEY").ok();
        let mut params: Vec<(&str, &str)> = vec![
            ("Action", "StartExportTask"),
            ("Version", "2014-10-31"),
            ("ExportTaskIdentifier", &export_id),
            ("SourceArn", &source_arn),
            ("S3BucketName", s3_bucket),
            ("IamRoleArn", &role_arn),
        ];
        if let Some(kms) = kms_key_id.as_deref() {
            params.push(("KmsKeyId", kms));
        }
        let endpoint = format!("rds.{}.amazonaws.com", self.client.region());
        self.client.query(&endpoint, "rds", &params).await?;
        Ok(())
    }
}

fn parse_create_db_snapshot_xml(xml: &str) -> Result<String> {
    let root = parse_xml_tree(xml)?;
    let id = root
        .descendants_named("DBSnapshotIdentifier")
        .first()
        .map(|n| n.text.clone())
        .unwrap_or_default();
    if id.is_empty() {
        anyhow::bail!("CreateDBSnapshot response did not contain a DBSnapshotIdentifier");
    }
    Ok(id)
}

fn parse_restore_db_instance_xml(xml: &str) -> Result<String> {
    let root = parse_xml_tree(xml)?;
    let id = root
        .descendants_named("DBInstanceIdentifier")
        .first()
        .map(|n| n.text.clone())
        .unwrap_or_default();
    if id.is_empty() {
        anyhow::bail!(
            "RestoreDBInstanceFromDBSnapshot response did not contain a DBInstanceIdentifier"
        );
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_create_db_snapshot_xml_returns_identifier() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<CreateDBSnapshotResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/">
    <CreateDBSnapshotResult>
        <DBSnapshot>
            <DBSnapshotIdentifier>bck-db-prod-2024-01-01</DBSnapshotIdentifier>
            <DBInstanceIdentifier>db-prod</DBInstanceIdentifier>
            <Status>creating</Status>
        </DBSnapshot>
    </CreateDBSnapshotResult>
</CreateDBSnapshotResponse>"#;
        assert_eq!(
            parse_create_db_snapshot_xml(xml).unwrap(),
            "bck-db-prod-2024-01-01"
        );
    }

    #[test]
    fn parse_restore_db_instance_xml_returns_identifier() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<RestoreDBInstanceFromDBSnapshotResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/">
    <RestoreDBInstanceFromDBSnapshotResult>
        <DBInstance>
            <DBInstanceIdentifier>db-restored</DBInstanceIdentifier>
            <Engine>postgres</Engine>
            <DBInstanceStatus>creating</DBInstanceStatus>
        </DBInstance>
    </RestoreDBInstanceFromDBSnapshotResult>
</RestoreDBInstanceFromDBSnapshotResponse>"#;
        assert_eq!(parse_restore_db_instance_xml(xml).unwrap(), "db-restored");
    }
}
