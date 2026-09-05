pub mod client;
pub mod ec2;
pub mod ebs;
pub mod rds;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::info;

use super::CloudAccount;

use client::{parse_xml_tree, AwsClient};
pub use client::AwsSession;

/// AWS connector — manages EC2, EBS, and RDS backups
pub struct AwsConnector {
    account: CloudAccount,
}

impl AwsConnector {
    pub fn new(account: CloudAccount) -> Self {
        Self { account }
    }

    /// Resolve credentials from the account or environment, then return an AWS session.
    pub async fn authenticate(&self) -> Result<AwsSession> {
        let access_key = self
            .account
            .access_key
            .clone()
            .or_else(|| std::env::var("AWS_ACCESS_KEY_ID").ok())
            .ok_or_else(|| {
                anyhow!("AWS access key not configured (set account.access_key or AWS_ACCESS_KEY_ID)")
            })?;
        let secret_key = self
            .account
            .secret_key
            .clone()
            .or_else(|| std::env::var("AWS_SECRET_ACCESS_KEY").ok())
            .ok_or_else(|| {
                anyhow!("AWS secret key not configured (set account.secret_key or AWS_SECRET_ACCESS_KEY)")
            })?;
        let session_token = self
            .account
            .session_token
            .clone()
            .or_else(|| std::env::var("AWS_SESSION_TOKEN").ok())
            .unwrap_or_default();
        let region = if !self.account.region.is_empty() {
            self.account.region.clone()
        } else {
            std::env::var("AWS_REGION")
                .or_else(|_| std::env::var("AWS_DEFAULT_REGION"))
                .unwrap_or_else(|_| "us-east-1".to_string())
        };
        info!("Authenticating with AWS: region={region}");
        Ok(AwsSession {
            region,
            access_key,
            secret_key,
            session_token,
        })
    }

    /// List all EC2 instances in the account
    pub async fn list_instances(&self) -> Result<Vec<Ec2Instance>> {
        let client = AwsClient::new(self.authenticate().await?);
        let endpoint = format!("ec2.{}.amazonaws.com", client.region());
        let body = client
            .query(
                &endpoint,
                "ec2",
                &[
                    ("Action", "DescribeInstances"),
                    ("Version", "2016-11-15"),
                ],
            )
            .await?;
        parse_ec2_xml(&body)
    }

    /// List all RDS instances
    pub async fn list_databases(&self) -> Result<Vec<RdsInstance>> {
        let client = AwsClient::new(self.authenticate().await?);
        let endpoint = format!("rds.{}.amazonaws.com", client.region());
        let body = client
            .query(
                &endpoint,
                "rds",
                &[
                    ("Action", "DescribeDBInstances"),
                    ("Version", "2014-10-31"),
                ],
            )
            .await?;
        parse_rds_xml(&body)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ec2Instance {
    pub id: String,
    pub name: String,
    pub instance_type: String,
    pub state: String,
    pub volumes: Vec<String>,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdsInstance {
    pub id: String,
    pub engine: String,
    pub engine_version: String,
    pub storage_gb: u64,
    pub multi_az: bool,
}

/// Parse an EC2 `DescribeInstances` XML response into `Ec2Instance`s.
fn parse_ec2_xml(xml: &str) -> Result<Vec<Ec2Instance>> {
    let root = parse_xml_tree(xml)?;
    let mut instances = Vec::new();
    for item in root.descendants_named("item") {
        let instance_id = item.text_of_child("instanceId");
        if instance_id.is_empty() {
            continue;
        }
        let instance_type = item.text_of_child("instanceType");
        let state = item
            .child("instanceState")
            .map(|n| n.text_of_child("name"))
            .unwrap_or_default();

        let mut tags = HashMap::new();
        if let Some(tag_set) = item.child("tagSet") {
            for tag_item in tag_set.children_named("item") {
                let key = tag_item.text_of_child("key");
                if !key.is_empty() {
                    tags.insert(key, tag_item.text_of_child("value"));
                }
            }
        }

        let mut volumes = Vec::new();
        if let Some(bdm) = item.child("blockDeviceMapping") {
            for map_item in bdm.children_named("item") {
                if let Some(vol) = map_item.child("ebs").and_then(|e| e.child("volumeId")) {
                    if !vol.text.is_empty() {
                        volumes.push(vol.text.clone());
                    }
                }
            }
        }

        let name = tags.get("Name").cloned().unwrap_or_default();
        instances.push(Ec2Instance {
            id: instance_id,
            name,
            instance_type,
            state,
            volumes,
            tags,
        });
    }
    Ok(instances)
}

/// Parse an RDS `DescribeDBInstances` XML response into `RdsInstance`s.
fn parse_rds_xml(xml: &str) -> Result<Vec<RdsInstance>> {
    let root = parse_xml_tree(xml)?;
    let mut instances = Vec::new();
    for node in root.descendants_named("DBInstance") {
        let id = node.text_of_child("DBInstanceIdentifier");
        if id.is_empty() {
            continue;
        }
        let storage_gb = node
            .text_of_child("AllocatedStorage")
            .trim()
            .parse::<u64>()
            .unwrap_or(0);
        let multi_az = matches!(node.text_of_child("MultiAZ").trim(), "true" | "1");
        instances.push(RdsInstance {
            id,
            engine: node.text_of_child("Engine"),
            engine_version: node.text_of_child("EngineVersion"),
            storage_gb,
            multi_az,
        });
    }
    Ok(instances)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::aws::client::sign_get_headers_at;
    use std::time::SystemTime;

    #[test]
    fn test_sign_get_headers_structure() {
        let session = AwsSession {
            region: "us-east-1".to_string(),
            access_key: "AKIDEXAMPLE".to_string(),
            secret_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".to_string(),
            session_token: String::new(),
        };
        let url = "https://ec2.us-east-1.amazonaws.com/?Action=DescribeInstances&Version=2016-11-15";
        let headers = sign_get_headers_at(url, "ec2", "us-east-1", &session, SystemTime::now())
            .expect("signing should succeed");
        let mut map = HashMap::new();
        for (k, v) in &headers {
            map.insert(k.as_str(), v.as_str());
        }
        assert!(map.contains_key("x-amz-date"));
        let auth = map.get("authorization").expect("authorization header present");
        assert!(auth.starts_with("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/"));
        assert!(auth.contains("/us-east-1/ec2/aws4_request"));
        assert!(auth.contains("SignedHeaders="));
        assert!(auth.contains("Signature="));
    }

    #[test]
    fn test_parse_ec2_xml() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
    <requestId>req-1</requestId>
    <reservationSet>
        <item>
            <reservationId>r-1234</reservationId>
            <instancesSet>
                <item>
                    <instanceId>i-0abc1234</instanceId>
                    <imageId>ami-12345</imageId>
                    <instanceType>t3.medium</instanceType>
                    <instanceState><name>running</name></instanceState>
                    <tagSet>
                        <item><key>Name</key><value>prod-web-01</value></item>
                        <item><key>Environment</key><value>prod</value></item>
                    </tagSet>
                    <blockDeviceMapping>
                        <item>
                            <deviceName>/dev/xvda</deviceName>
                            <ebs><volumeId>vol-0aaa</volumeId><status>attached</status></ebs>
                        </item>
                        <item>
                            <deviceName>/dev/sdb</deviceName>
                            <ebs><volumeId>vol-0bbb</volumeId><status>attached</status></ebs>
                        </item>
                    </blockDeviceMapping>
                </item>
            </instancesSet>
        </item>
        <item>
            <reservationId>r-5678</reservationId>
            <instancesSet>
                <item>
                    <instanceId>i-0def5678</instanceId>
                    <instanceType>m5.large</instanceType>
                    <instanceState><name>stopped</name></instanceState>
                </item>
            </instancesSet>
        </item>
    </reservationSet>
</DescribeInstancesResponse>"#;
        let instances = parse_ec2_xml(xml).unwrap();
        assert_eq!(instances.len(), 2);
        let first = &instances[0];
        assert_eq!(first.id, "i-0abc1234");
        assert_eq!(first.instance_type, "t3.medium");
        assert_eq!(first.state, "running");
        assert_eq!(first.name, "prod-web-01");
        assert_eq!(first.tags.get("Environment").map(|s| s.as_str()), Some("prod"));
        assert_eq!(first.volumes, vec!["vol-0aaa".to_string(), "vol-0bbb".to_string()]);
        let second = &instances[1];
        assert_eq!(second.id, "i-0def5678");
        assert_eq!(second.state, "stopped");
        assert!(second.volumes.is_empty());
    }

    #[test]
    fn test_parse_ec2_xml_empty() {
        let xml = r#"<DescribeInstancesResponse><reservationSet/></DescribeInstancesResponse>"#;
        assert!(parse_ec2_xml(xml).unwrap().is_empty());
    }

    #[test]
    fn test_parse_rds_xml() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeDBInstancesResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/">
    <DescribeDBInstancesResult>
        <DBInstances>
            <DBInstance>
                <DBInstanceIdentifier>db-prod</DBInstanceIdentifier>
                <Engine>postgres</Engine>
                <EngineVersion>15.4</EngineVersion>
                <AllocatedStorage>500</AllocatedStorage>
                <MultiAZ>true</MultiAZ>
            </DBInstance>
            <DBInstance>
                <DBInstanceIdentifier>db-backup</DBInstanceIdentifier>
                <Engine>mysql</Engine>
                <EngineVersion>8.0.33</EngineVersion>
                <AllocatedStorage>100</AllocatedStorage>
                <MultiAZ>false</MultiAZ>
            </DBInstance>
        </DBInstances>
    </DescribeDBInstancesResult>
</DescribeDBInstancesResponse>"#;
        let dbs = parse_rds_xml(xml).unwrap();
        assert_eq!(dbs.len(), 2);
        assert_eq!(dbs[0].id, "db-prod");
        assert_eq!(dbs[0].engine, "postgres");
        assert_eq!(dbs[0].engine_version, "15.4");
        assert_eq!(dbs[0].storage_gb, 500);
        assert!(dbs[0].multi_az);
        assert_eq!(dbs[1].id, "db-backup");
        assert!(!dbs[1].multi_az);
    }
}
