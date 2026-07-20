pub mod ec2;
pub mod ebs;
pub mod rds;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::CloudAccount;

/// AWS connector — manages EC2, EBS, and RDS backups
pub struct AwsConnector {
    account: CloudAccount,
}

impl AwsConnector {
    pub fn new(account: CloudAccount) -> Self {
        Self { account }
    }

    /// Authenticate with AWS using configured credentials
    pub async fn authenticate(&self) -> Result<AwsSession> {
        info!("Authenticating with AWS: region={}", self.account.region);
        // Use aws-sdk-s3 or aws-sdk-ec2
        Ok(AwsSession {
            region: self.account.region.clone(),
            session_token: String::new(),
        })
    }

    /// List all EC2 instances in the account
    pub async fn list_instances(&self) -> Result<Vec<Ec2Instance>> {
        // ec2:DescribeInstances
        Ok(Vec::new())
    }

    /// List all RDS instances
    pub async fn list_databases(&self) -> Result<Vec<RdsInstance>> {
        // rds:DescribeDBInstances
        Ok(Vec::new())
    }
}

pub struct AwsSession {
    pub region: String,
    pub session_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ec2Instance {
    pub id: String,
    pub name: String,
    pub instance_type: String,
    pub state: String,
    pub volumes: Vec<String>,
    pub tags: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdsInstance {
    pub id: String,
    pub engine: String,
    pub engine_version: String,
    pub storage_gb: u64,
    pub multi_az: bool,
}
