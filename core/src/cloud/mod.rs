pub mod aws;
pub mod azure;
pub mod gcp;
pub mod k8s;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudAccount {
    pub id: String,
    pub name: String,
    pub provider: CloudProvider,
    pub auth_type: String,
    pub region: String,
    pub status: AccountStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CloudProvider {
    Aws,
    Azure,
    Gcp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AccountStatus {
    Connected,
    Disconnected,
    AuthExpired,
    Error(String),
}

pub struct CloudBackupManager {
    accounts: Arc<RwLock<Vec<CloudAccount>>>,
}

impl CloudBackupManager {
    pub fn new() -> Self {
        Self {
            accounts: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn register_account(&self, account: CloudAccount) -> Result<CloudAccount> {
        let mut accounts = self.accounts.write().await;
        let account = CloudAccount {
            id: uuid::Uuid::new_v4().to_string(),
            ..account
        };
        info!("Cloud account registered: {} ({:?})", account.name, account.provider);
        accounts.push(account.clone());
        Ok(account)
    }

    pub async fn list_accounts(&self) -> Vec<CloudAccount> {
        self.accounts.read().await.clone()
    }
}

pub(crate) trait CloudProviderConnector: Send + Sync {
    fn provider(&self) -> CloudProvider;
    fn region(&self) -> &str;
}
