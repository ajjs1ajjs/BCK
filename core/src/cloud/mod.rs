pub mod aws;
pub mod azure;
pub mod gcp;
pub mod k8s;
pub mod restore;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudAccount {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub provider: CloudProvider,
    pub auth_type: String,
    pub region: String,
    pub status: AccountStatus,
    /// Owning tenant; `None` = global account (super-admin only).
    #[serde(default)]
    pub tenant_id: Option<String>,
    /// AWS static access key
    #[serde(default)]
    pub access_key: Option<String>,
    /// AWS static secret key
    #[serde(default)]
    pub secret_key: Option<String>,
    /// AWS session token (for temporary credentials)
    #[serde(default)]
    pub session_token: Option<String>,
    /// Azure AD tenant id
    #[serde(default)]
    pub azure_tenant_id: Option<String>,
    /// Azure AD application (client) id
    #[serde(default)]
    pub client_id: Option<String>,
    /// Azure AD application client secret
    #[serde(default)]
    pub client_secret: Option<String>,
    /// GCP project id
    #[serde(default)]
    pub project_id: Option<String>,
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

/// SEC-008: best-effort decrypt of enc: blobs using default key locations.
/// Legacy plaintext passes through for migration.
pub fn decrypt_stored(stored: &str) -> String {
    if !stored.starts_with("enc:") {
        return stored.to_string();
    }
    let candidates = [
        std::env::var("BCK_DATA_DIR").map(|d| format!("{}/keys/encryption.key", d)).unwrap_or_default(),
        "data/keys/encryption.key".to_string(),
        "./data/keys/encryption.key".to_string(),
    ];
    for p in candidates {
        if p.is_empty() {
            continue;
        }
        if let Ok(raw) = std::fs::read(&p) {
            if raw.len() == 32 {
                if let Ok(s) = crate::encrypt::decrypt_secret(&raw, stored) {
                    return s;
                }
            }
        }
    }
    tracing::warn!("cloud: cannot decrypt enc: secret (key unavailable)");
    stored.to_string()
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
        info!(
            "Cloud account registered: {} ({:?}) tenant={:?}",
            account.name, account.provider, account.tenant_id
        );
        accounts.push(account.clone());
        Ok(account)
    }

    pub async fn list_accounts(&self) -> Vec<CloudAccount> {
        self.accounts.read().await.clone()
    }

    /// Get a single account by id.
    pub async fn get_account(&self, id: &str) -> Option<CloudAccount> {
        self.accounts
            .read()
            .await
            .iter()
            .find(|a| a.id == id)
            .cloned()
    }

    /// Remove an account by id. Returns true if it existed.
    pub async fn remove_account(&self, id: &str) -> bool {
        let mut accounts = self.accounts.write().await;
        let before = accounts.len();
        accounts.retain(|a| a.id != id);
        info!("Cloud account removed: {}", id);
        accounts.len() != before
    }
}

#[allow(dead_code)]
pub(crate) trait CloudProviderConnector: Send + Sync {
    fn provider(&self) -> CloudProvider;
    fn region(&self) -> &str;
}
