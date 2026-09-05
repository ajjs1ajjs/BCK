use anyhow::Result;
use tracing::info;

use crate::cloud::aws::client::{parse_xml_tree, AwsClient, AwsSession};

/// EBS snapshot management
pub struct EbsSnapshotManager {
    client: AwsClient,
}

impl EbsSnapshotManager {
    pub fn new() -> Self {
        let client = AwsClient::from_env().unwrap_or_else(|_| AwsClient::new(AwsSession::default()));
        Self { client }
    }

    pub fn new_with(session: AwsSession) -> Self {
        Self {
            client: AwsClient::new(session),
        }
    }

    /// Create a snapshot of an EBS volume, returning the snapshot id.
    pub async fn create_snapshot(&self, volume_id: &str, description: &str) -> Result<String> {
        info!("Creating EBS snapshot for volume: {volume_id}");
        let endpoint = format!("ec2.{}.amazonaws.com", self.client.region());
        let body = self
            .client
            .query(
                &endpoint,
                "ec2",
                &[
                    ("Action", "CreateSnapshot"),
                    ("Version", "2016-11-15"),
                    ("VolumeId", volume_id),
                    ("Description", description),
                ],
            )
            .await?;
        parse_snapshot_id_xml(&body, "CreateSnapshot")
    }

    /// Restore a volume from a snapshot, returning the new volume id.
    pub async fn restore_volume(&self, snapshot_id: &str, availability_zone: &str) -> Result<String> {
        info!("Restoring EBS volume from snapshot: {snapshot_id}");
        let endpoint = format!("ec2.{}.amazonaws.com", self.client.region());
        let body = self
            .client
            .query(
                &endpoint,
                "ec2",
                &[
                    ("Action", "CreateVolume"),
                    ("Version", "2016-11-15"),
                    ("SnapshotId", snapshot_id),
                    ("AvailabilityZone", availability_zone),
                ],
            )
            .await?;
        let root = parse_xml_tree(&body)?;
        let id = root
            .descendants_named("volumeId")
            .first()
            .map(|n| n.text.clone())
            .unwrap_or_default();
        if id.is_empty() {
            anyhow::bail!("CreateVolume response did not contain a volumeId");
        }
        Ok(id)
    }

    /// Delete snapshots older than `retention_days`, returning how many were deleted.
    pub async fn apply_retention(&self, retention_days: u32) -> Result<u64> {
        info!("Applying EBS snapshot retention ({} days)", retention_days);
        let endpoint = format!("ec2.{}.amazonaws.com", self.client.region());
        let body = self
            .client
            .query(
                &endpoint,
                "ec2",
                &[
                    ("Action", "DescribeSnapshots"),
                    ("Version", "2016-11-15"),
                    ("OwnerIds.1", "self"),
                ],
            )
            .await?;
        let snapshots = parse_snapshots(&body)?;
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
        let mut deleted = 0u64;
        for (snapshot_id, created_at) in snapshots {
            if created_at < cutoff {
                info!("Deleting stale snapshot {snapshot_id} (created {created_at})");
                self.client
                    .query(
                        &endpoint,
                        "ec2",
                        &[
                            ("Action", "DeleteSnapshot"),
                            ("Version", "2016-11-15"),
                            ("SnapshotId", &snapshot_id),
                        ],
                    )
                    .await?;
                deleted += 1;
            }
        }
        Ok(deleted)
    }

    /// Copy a snapshot to another region for DR, returning the new snapshot id.
    pub async fn copy_to_region(&self, snapshot_id: &str, target_region: &str) -> Result<String> {
        info!("Copying EBS snapshot {snapshot_id} to region: {target_region}");
        let endpoint = format!("ec2.{target_region}.amazonaws.com");
        let body = self
            .client
            .query_in_region(
                &endpoint,
                "ec2",
                target_region,
                &[
                    ("Action", "CopySnapshot"),
                    ("Version", "2016-11-15"),
                    ("SourceRegion", self.client.region()),
                    ("SourceSnapshotId", snapshot_id),
                ],
            )
            .await?;
        parse_snapshot_id_xml(&body, "CopySnapshot")
    }
}

fn parse_snapshot_id_xml(xml: &str, action: &str) -> Result<String> {
    let root = parse_xml_tree(xml)?;
    let id = root
        .descendants_named("snapshotId")
        .first()
        .map(|n| n.text.clone())
        .unwrap_or_default();
    if id.is_empty() {
        anyhow::bail!("{action} response did not contain a snapshotId");
    }
    Ok(id)
}

/// Parse `DescribeSnapshots` XML into `(snapshotId, startTime)` pairs in UTC.
fn parse_snapshots(xml: &str) -> Result<Vec<(String, chrono::DateTime<chrono::Utc>)>> {
    let root = parse_xml_tree(xml)?;
    let mut out = Vec::new();
    for item in root.descendants_named("item") {
        let snapshot_id = item.text_of_child("snapshotId");
        if snapshot_id.is_empty() {
            continue;
        }
        let start = item.text_of_child("startTime");
        let created_at = match chrono::DateTime::parse_from_rfc3339(&start) {
            Ok(dt) => dt.with_timezone(&chrono::Utc),
            Err(_) => continue,
        };
        out.push((snapshot_id, created_at));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_snapshots_extracts_id_and_start_time() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeSnapshotsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
    <requestId>req-789</requestId>
    <snapshotSet>
        <item>
            <snapshotId>snap-0aaa</snapshotId>
            <volumeId>vol-0aaa</volumeId>
            <status>completed</status>
            <startTime>2024-01-15T10:30:00.000Z</startTime>
        </item>
        <item>
            <snapshotId>snap-0bbb</snapshotId>
            <volumeId>vol-0bbb</volumeId>
            <status>completed</status>
            <startTime>2024-06-01T08:00:00.000Z</startTime>
        </item>
    </snapshotSet>
</DescribeSnapshotsResponse>"#;
        let snapshots = parse_snapshots(xml).unwrap();
        assert_eq!(snapshots.len(), 2);
        assert_eq!(snapshots[0].0, "snap-0aaa");
        assert_eq!(
            snapshots[0].1,
            chrono::DateTime::parse_from_rfc3339("2024-01-15T10:30:00.000Z")
                .unwrap()
                .with_timezone(&chrono::Utc)
        );
        assert_eq!(snapshots[1].0, "snap-0bbb");
        assert!(snapshots[1].1 > snapshots[0].1);
    }
}
