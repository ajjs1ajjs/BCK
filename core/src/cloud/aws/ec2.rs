use anyhow::Result;
use tracing::info;

use crate::cloud::aws::client::{parse_xml_tree, AwsClient, AwsSession};

/// EC2 instance backup — uses EBS snapshots and AMI creation
pub struct Ec2Backup {
    client: AwsClient,
}

impl Ec2Backup {
    pub fn new() -> Self {
        let client = AwsClient::from_env().unwrap_or_else(|_| AwsClient::new(AwsSession::default()));
        Self { client }
    }

    pub fn new_with(session: AwsSession) -> Self {
        Self {
            client: AwsClient::new(session),
        }
    }

    /// Create an AMI from an EC2 instance, returning the new AMI id.
    pub async fn create_ami(&self, instance_id: &str, name: &str) -> Result<String> {
        info!("Creating AMI from instance: {instance_id}");
        let endpoint = format!("ec2.{}.amazonaws.com", self.client.region());
        let body = self
            .client
            .query(
                &endpoint,
                "ec2",
                &[
                    ("Action", "CreateImage"),
                    ("Version", "2016-11-15"),
                    ("InstanceId", instance_id),
                    ("Name", name),
                    ("NoReboot", "true"),
                ],
            )
            .await?;
        parse_create_image_xml(&body)
    }

    /// Restore an EC2 instance from an AMI, returning the new instance id.
    pub async fn restore_from_ami(&self, ami_id: &str, name: &str) -> Result<String> {
        info!("Restoring EC2 from AMI: {ami_id} as {name}");
        let endpoint = format!("ec2.{}.amazonaws.com", self.client.region());
        let body = self
            .client
            .query(
                &endpoint,
                "ec2",
                &[
                    ("Action", "RunInstances"),
                    ("Version", "2016-11-15"),
                    ("ImageId", ami_id),
                    ("MinCount", "1"),
                    ("MaxCount", "1"),
                    ("TagSpecification.1.ResourceType", "instance"),
                    ("TagSpecification.1.Tag.1.Key", "bck:backup"),
                    ("TagSpecification.1.Tag.1.Value", "true"),
                    ("TagSpecification.1.Tag.2.Key", "Name"),
                    ("TagSpecification.1.Tag.2.Value", name),
                ],
            )
            .await?;
        parse_run_instances_xml(&body)
    }

    /// List AMIs created by BCK (tagged `bck:backup=true`).
    pub async fn list_backups(&self) -> Result<Vec<String>> {
        let endpoint = format!("ec2.{}.amazonaws.com", self.client.region());
        let body = self
            .client
            .query(
                &endpoint,
                "ec2",
                &[
                    ("Action", "DescribeImages"),
                    ("Version", "2016-11-15"),
                    ("Filters.1.Name", "tag:bck:backup"),
                    ("Filters.1.Value.1", "true"),
                ],
            )
            .await?;
        parse_describe_images_xml(&body)
    }
}

fn parse_create_image_xml(xml: &str) -> Result<String> {
    let root = parse_xml_tree(xml)?;
    let id = root
        .descendants_named("imageId")
        .first()
        .map(|n| n.text.clone())
        .unwrap_or_default();
    if id.is_empty() {
        anyhow::bail!("CreateImage response did not contain an imageId");
    }
    Ok(id)
}

fn parse_run_instances_xml(xml: &str) -> Result<String> {
    let root = parse_xml_tree(xml)?;
    let id = root
        .descendants_named("instanceId")
        .first()
        .map(|n| n.text.clone())
        .unwrap_or_default();
    if id.is_empty() {
        anyhow::bail!("RunInstances response did not contain an instanceId");
    }
    Ok(id)
}

fn parse_describe_images_xml(xml: &str) -> Result<Vec<String>> {
    let root = parse_xml_tree(xml)?;
    Ok(root
        .descendants_named("imageId")
        .into_iter()
        .map(|n| n.text.clone())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_create_image_xml() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<CreateImageResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
    <requestId>req-123</requestId>
    <imageId>ami-0f5e2b9c8d1a3e4f</imageId>
</CreateImageResponse>"#;
        assert_eq!(parse_create_image_xml(xml).unwrap(), "ami-0f5e2b9c8d1a3e4f");
    }

    #[test]
    fn test_parse_describe_images_xml() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeImagesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
    <requestId>req-456</requestId>
    <imagesSet>
        <item>
            <imageId>ami-0abc1234</imageId>
            <name>bck-web-prod-2024-01-01</name>
            <tagSet><item><key>bck:backup</key><value>true</value></item></tagSet>
        </item>
        <item>
            <imageId>ami-0def5678</imageId>
            <name>bck-db-prod-2024-01-02</name>
        </item>
    </imagesSet>
</DescribeImagesResponse>"#;
        assert_eq!(
            parse_describe_images_xml(xml).unwrap(),
            vec!["ami-0abc1234".to_string(), "ami-0def5678".to_string()]
        );
    }
}
