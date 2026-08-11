use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub storage: StorageConfig,
    pub encryption: EncryptionConfig,
    pub logging: LoggingConfig,
    /// Pre-shared token agents must present (`Authorization: Bearer <token>`)
    /// when calling agent endpoints. When empty the daemon auto-generates and
    /// persists one on first start.
    #[serde(default)]
    pub agent_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub grpc_port: u16,
    pub web_ui_dir: Option<String>,
    pub tls_cert: Option<String>,
    pub tls_key: Option<String>,
    /// Cross-origin request allowlist (e.g. ["https://backups.example.com"]).
    /// Empty (default) = same-origin only; the SPA is served by the daemon.
    #[serde(default)]
    pub allowed_origins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
    pub pool_size: u32,
    pub migrate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub default_path: PathBuf,
    pub temp_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionConfig {
    pub key_path: Option<PathBuf>,
    pub algorithm: String,
    /// Optional passphrase that wraps the encryption key at rest (Argon2-derived
    /// key encrypts the stored key file). When set, the key file cannot be used
    /// without it; when unset, a raw 32-byte key file is used.
    #[serde(default)]
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
    pub json: bool,
    pub file: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                host: "0.0.0.0".into(),
                port: 9440,
                grpc_port: 9441,
                web_ui_dir: Some("./web-ui/dist".into()),
                tls_cert: None,
                tls_key: None,
                allowed_origins: Vec::new(),
            },
            database: DatabaseConfig {
                url: "sqlite://./data/bck.db?mode=rwc".into(),
                pool_size: 10,
                migrate: true,
            },
            storage: StorageConfig {
                default_path: PathBuf::from("./data/backups"),
                temp_path: PathBuf::from("./data/tmp"),
            },
            encryption: EncryptionConfig {
                key_path: None,
                algorithm: "aes-256-gcm".into(),
                passphrase: None,
            },
            logging: LoggingConfig {
                level: "info".into(),
                json: false,
                file: None,
            },
            agent_token: None,
        }
    }
}

impl AppConfig {
    pub fn load(path: &str) -> Result<Self, anyhow::Error> {
        let content = std::fs::read_to_string(path)?;
        let config: AppConfig = toml::from_str(&content)?;
        Ok(config)
    }

    pub fn save(&self, path: &str) -> Result<(), anyhow::Error> {
        let content = toml::to_string_pretty(self)?;
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, content)?;
        Ok(())
    }
}
