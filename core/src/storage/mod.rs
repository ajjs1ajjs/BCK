pub mod local;
pub mod s3;
pub mod azure;
pub mod gcs;

use std::net::ToSocketAddrs;

use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;

#[async_trait]
pub trait StorageBackend: Send + Sync {
    async fn write_block(&self, id: &str, data: &[u8]) -> Result<()>;
    async fn read_block(&self, id: &str) -> Result<Vec<u8>>;
    async fn delete_block(&self, id: &str) -> Result<()>;
    async fn exists(&self, id: &str) -> Result<bool>;
    async fn list_blocks(&self, prefix: &str) -> Result<Vec<String>>;
    async fn stats(&self) -> Result<StorageStats>;
    async fn test_connection(&self) -> Result<()>;
    fn name(&self) -> &str;
    fn backend_type(&self) -> &'static str;
}

#[derive(Debug, Clone)]
pub struct StorageStats {
    pub capacity_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub total_blocks: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct StorageConfig {
    pub backend_type: String,
    pub path: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
    pub container: Option<String>,
    pub connection_string: Option<String>,
    pub account: Option<String>,
    /// S3 Object Lock retention days (WORM COMPLIANCE). None/0 = disabled.
    #[serde(default)]
    pub object_lock_days: Option<u32>,
}

/// Build a `StorageConfig` from a stored JSON config, decrypting the secret
/// fields (`access_key`, `secret_key`, `connection_string`) with the application
/// key when it is provided. Plaintext legacy values decrypt transparently.
///
/// BUG-003: decryption failures are logged (not silently dropped to None),
/// so misconfigured credentials fail loudly at backend creation instead of
/// producing empty-string secrets.
pub fn storage_config_from_json(cfg: &serde_json::Value, key: Option<&[u8]>) -> StorageConfig {
    let decrypt = |field: &str, v: Option<&str>| -> Option<String> {
        let v = v?;
        match key {
            Some(k) => match crate::encrypt::decrypt_secret(k, v) {
                Ok(s) => Some(s),
                Err(e) => {
                    tracing::warn!("storage config: failed to decrypt {}: {}", field, e);
                    None
                }
            },
            None => Some(v.to_string()),
        }
    };
    StorageConfig {
        backend_type: cfg["backend_type"].as_str().unwrap_or_default().to_string(),
        path: cfg["path"].as_str().map(str::to_string),
        bucket: cfg["bucket"].as_str().map(str::to_string),
        region: cfg["region"].as_str().map(str::to_string),
        endpoint: cfg["endpoint"].as_str().map(str::to_string),
        access_key: decrypt("access_key", cfg["access_key"].as_str()),
        secret_key: decrypt("secret_key", cfg["secret_key"].as_str()),
        container: cfg["container"].as_str().map(str::to_string),
        connection_string: decrypt("connection_string", cfg["connection_string"].as_str()),
        account: cfg["account"].as_str().map(str::to_string),
        object_lock_days: cfg["object_lock_days"].as_u64().map(|v| v as u32),
    }
}

pub async fn create_backend(config: StorageConfig) -> Result<Box<dyn StorageBackend>> {
    // Custom object-storage endpoints are validated to stop the daemon being
    // used to probe internal/cloud-metadata hosts (SSRF).
    if let Some(endpoint) = &config.endpoint {
        validate_storage_endpoint(endpoint)?;
    }
    match config.backend_type.to_lowercase().as_str() {
        "local" | "filesystem" => {
            let path = config.path.unwrap_or_else(|| "./backup-store".into());
            Ok(Box::new(local::LocalStorage::new(&path)?))
        }
        "s3" => {
            let backend = s3::S3Storage::new_with_lock(
                &config.bucket.unwrap_or_default(),
                &config.region.unwrap_or_default(),
                config.endpoint.as_deref(),
                config.access_key.as_deref(),
                config.secret_key.as_deref(),
                config.object_lock_days.filter(|d| *d > 0),
            ).await?;
            Ok(Box::new(backend))
        }
        "azure" => {
            let account = config.account.clone()
                .or_else(|| config.bucket.clone())
                .ok_or_else(|| anyhow::anyhow!("Azure storage requires an account name"))?;
            let key = config.secret_key.as_deref()
                .or_else(|| config.access_key.as_deref())
                .ok_or_else(|| anyhow::anyhow!("Azure storage requires an access key"))?;
            let container = config.container.clone()
                .unwrap_or_else(|| "bck".into());
            let backend = azure::AzureBlobStorage::new(
                &account,
                key,
                &container,
                config.connection_string.as_deref(),
            ).await?;
            Ok(Box::new(backend))
        }
        "gcs" | "google" | "google-cloud" => {
            let bucket = config.bucket.ok_or_else(|| anyhow::anyhow!("GCS storage requires a bucket"))?;
            let region = config.region.clone().unwrap_or_else(|| "auto".into());
            let backend = gcs::GcsStorage::new(
                &bucket,
                &region,
                config.access_key.as_deref(),
                config.secret_key.as_deref(),
            ).await?;
            Ok(Box::new(backend))
        }
        _ => anyhow::bail!("Unsupported storage backend: {}", config.backend_type),
    }
}

/// Validate a hypervisor host (VMware/Hyper-V) against SSRF.
/// SEC-009: same IP blocklist as storage endpoints, but private/DC ranges are
/// allowed via explicit opt-in BCK_ALLOW_PRIVATE_HV=1 (hypervisors normally
/// live in private networks). Cloud metadata (169.254.169.254), loopback
/// (unless explicitly allowed), link-local and multicast stay blocked.
pub fn validate_hypervisor_host(host: &str) -> Result<()> {
    let h = host.trim();
    if h.is_empty() || h.len() > 253 || h.chars().any(|c| c.is_control()) {
        anyhow::bail!("invalid hypervisor host");
    }
    // Block URL-like values, userinfo, ports embedded, path traversal.
    if h.contains("://") || h.contains('@') || h.contains('/') || h.contains('\\') || h.contains("..") {
        anyhow::bail!("invalid hypervisor host");
    }
    let allow_private = std::env::var("BCK_ALLOW_PRIVATE_HV").as_deref() == Ok("1");
    // Literal IP fast path.
    if let Ok(ip) = h.trim_matches(|c| c == '[' || c == ']').parse::<std::net::IpAddr>() {
        return check_hv_ip(ip, h, allow_private);
    }
    // Hostname: resolve best-effort and check each addr.
    match format!("{}:443", h).to_socket_addrs() {
        Ok(addrs) => {
            let mut any = false;
            for addr in addrs {
                any = true;
                check_hv_ip(addr.ip(), h, allow_private)?;
            }
            if !any {
                anyhow::bail!("hypervisor host did not resolve: {h}");
            }
            Ok(())
        }
        Err(_) => {
            // Unresolvable now (DNS may appear later): allow the hostname but
            // it must look like a valid DNS name to avoid injection.
            if !h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') {
                anyhow::bail!("invalid hypervisor host");
            }
            Ok(())
        }
    }
}

fn check_hv_ip(ip: std::net::IpAddr, host: &str, allow_private: bool) -> Result<()> {
    let oct = match ip {
        std::net::IpAddr::V4(v4) => Some(v4.octets()),
        _ => None,
    };
    // Always blocked: unspecified, multicast, link-local, cloud metadata.
    let mut bad = match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_unspecified() || v4.is_multicast() || v4.is_link_local()
        }
        std::net::IpAddr::V6(v6) => v6.is_unspecified() || v6.is_multicast() || v6.is_unicast_link_local(),
    };
    if let Some(o) = oct {
        if o[0] == 169 && o[1] == 254 {
            bad = true; // cloud metadata (AWS/GCP/Azure)
        }
    }
    if bad {
        anyhow::bail!("hypervisor host resolves to a blocked address: {host}");
    }
    if !allow_private {
        let is_private = match ip {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private(),
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unicast_link_local(),
        };
        if is_private {
            anyhow::bail!("hypervisor host is private/loopback (set BCK_ALLOW_PRIVATE_HV=1 for on-prem DC): {host}");
        }
    }
    Ok(())
}

/// Validate a custom object-storage endpoint (S3-compatible etc.). Only
/// http/https are accepted and link-local/metadata/unspecified addresses are
/// rejected so the daemon cannot be pointed at internal or cloud-metadata
/// hosts (SSRF). Loopback and RFC1918 private addresses are rejected by default;
/// set `BCK_ALLOW_PRIVATE_ENDPOINTS=1` to allow on-prem storage.
///
/// SEC-005 (DNS rebinding): DNS names are resolved at validation time, but the
/// actual S3 client resolves again at request time (TOCTOU). By default DNS
/// hostnames are rejected — use a literal IP, or set
/// `BCK_ALLOW_DNS_ENDPOINTS=1` to acknowledge the rebinding risk (only for
/// trusted DNS).
pub fn validate_storage_endpoint(endpoint: &str) -> Result<()> {
    let u = reqwest::Url::parse(endpoint)
        .map_err(|_| anyhow::anyhow!("invalid storage endpoint: {endpoint}"))?;
    match u.scheme() {
        "http" | "https" => {}
        other => anyhow::bail!("unsupported storage endpoint scheme: {other}"),
    }
    if let Some(host) = u.host_str() {
        // Check literal IP first
        if let Ok(ip) = host.parse::<std::net::IpAddr>() {
            check_ip(ip, endpoint)?;
        } else {
            // Hostname: fail closed by default to kill DNS-rebinding TOCTOU.
            if std::env::var("BCK_ALLOW_DNS_ENDPOINTS").as_deref() != Ok("1") {
                anyhow::bail!(
                    "storage endpoint must be a literal IP (DNS rebinding risk); use an IP or set BCK_ALLOW_DNS_ENDPOINTS=1 for trusted DNS: {endpoint}"
                );
            }
            if std::env::var("BCK_ALLOW_PRIVATE_ENDPOINTS").as_deref() != Ok("1") {
                // Best-effort check at validation time (request-time may differ).
                let addrs = format!("{}:443", host).to_socket_addrs();
                if let Ok(addrs) = addrs {
                    for addr in addrs {
                        check_ip(addr.ip(), endpoint)?;
                    }
                }
            }
        }
    }
    Ok(())
}

fn check_ip(ip: std::net::IpAddr, endpoint: &str) -> Result<()> {
    let mut bad = match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_unspecified()
                || v4.is_link_local()
                || v4.is_multicast()
                || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
        }
        std::net::IpAddr::V6(v6) => v6.is_unspecified() || v6.is_multicast() || v6.is_unicast_link_local(),
    };
    if !bad && std::env::var("BCK_ALLOW_PRIVATE_ENDPOINTS").as_deref() != Ok("1") {
        bad = match ip {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private(),
            std::net::IpAddr::V6(v6) => v6.is_loopback(),
        };
        if bad {
            anyhow::bail!(
                "storage endpoint must not point to a private/loopback address (set BCK_ALLOW_PRIVATE_ENDPOINTS=1 to allow): {endpoint}"
            );
        }
    }
    if bad {
        anyhow::bail!("storage endpoint must not point to a link-local/metadata address: {endpoint}");
    }
    Ok(())
}
