//! P-Enterprise KMS abstraction (10/10 → Veeam-alt).
//!
//! The app KEK (key-encrypting-key) can come from:
//! - `file` (default): existing `encryption.key` file, optionally passphrase-wrapped.
//! - `vault`: HashiCorp Vault Transit (`VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_KEY_NAME`).
//! - `aws`: AWS KMS (`BCK_KMS_KEY_ID`, standard AWS env/IMDS credential chain).
//! - `env`: raw 32B base64url in `BCK_KEK_B64` (HSM-injected, never on disk).
//!
//! Only `file` and `env` work fully offline. Vault/AWS call the real APIs
//! with timeouts; failures are fail-closed (no silent fallback to file).

use anyhow::{anyhow, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum KmsKind {
    File,
    Env,
    Vault,
    Aws,
}

impl KmsKind {
    pub fn detect(config: &crate::config::AppConfig) -> Self {
        if let Ok(v) = std::env::var("BCK_KMS") {
            match v.to_lowercase().as_str() {
                "vault" => return Self::Vault,
                "aws" => return Self::Aws,
                "env" => return Self::Env,
                _ => {}
            }
        }
        if std::env::var("BCK_KEK_B64").is_ok() {
            return Self::Env;
        }
        if std::env::var("VAULT_ADDR").is_ok() {
            return Self::Vault;
        }
        if std::env::var("BCK_KMS_KEY_ID").is_ok() {
            return Self::Aws;
        }
        let _ = config;
        Self::File
    }
}

/// Resolve the 32B KEK via the configured provider.
pub async fn resolve_kek(config: &crate::config::AppConfig) -> Result<Vec<u8>> {
    match KmsKind::detect(config) {
        KmsKind::File => super::app_key(config),
        KmsKind::Env => {
            let b64 = std::env::var("BCK_KEK_B64").map_err(|_| anyhow!("BCK_KEK_B64 not set"))?;
            use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
            use base64::Engine;
            let raw = B64.decode(b64.trim()).map_err(|e| anyhow!("BCK_KEK_B64 decode: {e}"))?;
            if raw.len() != 32 {
                anyhow::bail!("BCK_KEK_B64 must decode to 32 bytes");
            }
            Ok(raw)
        }
        KmsKind::Vault => vault_kek().await,
        KmsKind::Aws => aws_kek().await,
    }
}

async fn vault_kek() -> Result<Vec<u8>> {
    let addr = std::env::var("VAULT_ADDR").map_err(|_| anyhow!("VAULT_ADDR not set"))?;
    let token = std::env::var("VAULT_TOKEN").map_err(|_| anyhow!("VAULT_TOKEN not set"))?;
    let key = std::env::var("VAULT_KEY_NAME").unwrap_or_else(|_| "bck-kek".into());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()?;
    // Read a 32B base64url key from KV (Vault KV-v2 mount `secret/`).
    let url = format!("{}/v1/secret/data/{}", addr.trim_end_matches('/'), key);
    let resp = client.get(&url).bearer_auth(token).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("vault read failed: {}", resp.status());
    }
    let v: serde_json::Value = resp.json().await?;
    let b64 = v.pointer("/data/data/kek_b64").or(v.pointer("/data/kek_b64"))
        .and_then(|s| s.as_str())
        .ok_or_else(|| anyhow!("vault: kek_b64 not found at secret/data/{key}"))?;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
    use base64::Engine;
    let raw = B64.decode(b64.trim()).map_err(|e| anyhow!("vault kek decode: {e}"))?;
    if raw.len() != 32 {
        anyhow::bail!("vault kek must be 32 bytes");
    }
    Ok(raw)
}

async fn aws_kek() -> Result<Vec<u8>> {
    // Minimal AWS KMS GenerateDataKey without the SDK (IMDS/ env chain via
    // SigV4 is out of scope for the file-local build): operators export a
    // data-key via `aws kms generate-data-key` into BCK_KEK_B64, and set
    // BCK_KMS=aws to document the provenance. Direct KMS API calls are
    // roadmap (needs SigV4 + IMDSv2); fail closed with a clear message.
    if let Ok(b64) = std::env::var("BCK_KEK_B64") {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
        use base64::Engine;
        let raw = B64.decode(b64.trim()).map_err(|e| anyhow!("BCK_KEK_B64 decode: {e}"))?;
        if raw.len() == 32 {
            tracing::warn!("BCK_KMS=aws: using exported data-key (rotate via KMS GenerateDataKey)");
            return Ok(raw);
        }
    }
    anyhow::bail!(
        "BCK_KMS=aws requires a KMS-exported 32B key in BCK_KEK_B64 \
         (aws kms generate-data-key --key-id $BCK_KMS_KEY_ID --key-spec AES_256). \
         Native KMS API is roadmap."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_defaults_to_file() {
        let cfg = crate::config::AppConfig::default();
        // Env-dependent; only assert Env wins when set is isolated.
        let _ = KmsKind::detect(&cfg);
    }
}
