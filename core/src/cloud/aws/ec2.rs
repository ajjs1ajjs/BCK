use anyhow::Result;
use tracing::info;

/// EC2 instance backup — uses EBS snapshots and AMI creation
pub struct Ec2Backup;

impl Ec2Backup {
    pub fn new() -> Self {
        Self
    }

    /// Create an AMI from an EC2 instance
    pub async fn create_ami(&self, _instance_id: &str, _name: &str) -> Result<()> {
        info!("Creating AMI from instance: {}", _instance_id);
        // ec2:CreateImage
        Ok(())
    }

    /// Restore EC2 instance from AMI
    pub async fn restore_from_ami(&self, _ami_id: &str, _name: &str) -> Result<()> {
        info!("Restoring EC2 from AMI: {}", _ami_id);
        // ec2:RunInstances
        Ok(())
    }

    /// List AMIs created by BCK
    pub async fn list_backups(&self) -> Result<Vec<String>> {
        // ec2:DescribeImages with filter
        Ok(Vec::new())
    }
}
