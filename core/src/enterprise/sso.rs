use anyhow::{Result, anyhow, bail};
use base64::Engine;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SsoProvider {
    pub id: String,
    pub name: String,
    pub provider_type: SsoType,
    pub issuer_url: String,
    pub client_id: String,
    pub encrypted_client_secret: String,
    pub scopes: Vec<String>,
    pub auto_provision: bool,
    pub default_role: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SsoType {
    Oidc,
    Saml,
    Ldap,
    AzureAd,
    GoogleWorkspace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SsoUser {
    pub external_id: String,
    pub email: String,
    pub display_name: String,
    pub provider_id: String,
    pub roles: Vec<String>,
    pub tenant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapConfig {
    pub url: String,
    pub bind_dn: String,
    pub bind_password: String,
    pub base_dn: String,
    pub user_filter: String,
    pub group_filter: String,
    pub tls: bool,
}

// ---- OIDC wire types ----
// These are deserialization schemas; fields are validated by jsonwebtoken and
// the serde layer, so rustc may not see direct reads.

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct Discovery {
    issuer: Option<String>,
    authorization_endpoint: Option<String>,
    token_endpoint: Option<String>,
    jwks_uri: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    id_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct Jwk {
    kty: String,
    kid: Option<String>,
    alg: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct JwtHeader {
    alg: Option<String>,
    kid: Option<String>,
    typ: Option<String>,
}

/// Claims extracted from a validated ID token. `iss`/`aud`/`exp` are consumed
/// by jsonwebtoken's `Validation`.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    iss: Option<String>,
    aud: Option<serde_json::Value>,
    exp: Option<u64>,
    email: Option<String>,
    name: Option<String>,
    groups: Option<Vec<String>>,
    tid: Option<String>,
    tenant_id: Option<String>,
}

/// SSO Manager — handles OIDC, SAML, LDAP authentication
pub struct SsoManager {
    providers: Arc<RwLock<HashMap<String, SsoProvider>>>,
    ldap_configs: Arc<RwLock<Vec<LdapConfig>>>,
    http: reqwest::Client,
}

impl Default for SsoManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SsoManager {
    pub fn new() -> Self {
        Self {
            providers: Arc::new(RwLock::new(HashMap::new())),
            ldap_configs: Arc::new(RwLock::new(Vec::new())),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    /// Register an SSO provider
    pub async fn register_provider(&self, provider: SsoProvider) -> Result<SsoProvider> {
        let mut providers = self.providers.write().await;
        let provider = SsoProvider {
            id: uuid::Uuid::new_v4().to_string(),
            ..provider
        };
        info!("SSO provider registered: {} ({:?})", provider.name, provider.provider_type);
        providers.insert(provider.id.clone(), provider.clone());
        Ok(provider)
    }

    /// Register an LDAP server configuration
    pub async fn add_ldap_config(&self, cfg: LdapConfig) {
        let mut configs = self.ldap_configs.write().await;
        configs.push(cfg);
    }

    /// Initiate OIDC authentication: returns a real authorization URL.
    pub async fn initiate_auth(&self, provider_id: &str, redirect_uri: &str) -> Result<String> {
        let providers = self.providers.read().await;
        let provider = providers.get(provider_id)
            .ok_or_else(|| anyhow!("SSO provider not found: {}", provider_id))?
            .clone();

        let discovery = self.discovery(&provider).await?;
        let auth_endpoint = discovery.authorization_endpoint
            .ok_or_else(|| anyhow!("Provider {} has no authorization endpoint", provider.name))?;

        let state = uuid::Uuid::new_v4().to_string();
        let mut scopes = provider.scopes.clone();
        if !scopes.iter().any(|s| s == "openid") {
            scopes.push("openid".into());
        }

        info!("Initiating OIDC auth for provider {}", provider.name);
        Ok(format!(
            "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
            auth_endpoint,
            urlencode(&provider.client_id),
            urlencode(redirect_uri),
            urlencode(&scopes.join(" ")),
            urlencode(&state),
        ))
    }

    /// Handle OIDC callback: exchange the code for tokens, validate the ID
    /// token (signature via JWKS, issuer and audience), and build a user.
    pub async fn handle_callback(
        &self,
        provider_id: &str,
        code: &str,
        _state: &str,
        redirect_uri: &str,
    ) -> Result<SsoUser> {
        let providers = self.providers.read().await;
        let provider = providers.get(provider_id)
            .ok_or_else(|| anyhow!("SSO provider not found: {}", provider_id))?
            .clone();
        drop(providers);

        let discovery = self.discovery(&provider).await?;
        let token_endpoint = discovery.token_endpoint
            .ok_or_else(|| anyhow!("Provider {} has no token endpoint", provider.name))?;

        let resp = self.http.post(&token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("client_id", provider.client_id.as_str()),
                ("client_secret", provider.encrypted_client_secret.as_str()),
            ])
            .send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("OIDC token exchange failed ({}): {}", status, body));
        }
        let tokens: TokenResponse = resp.json().await?;
        let id_token = tokens.id_token
            .ok_or_else(|| anyhow!("Token response missing id_token"))?;

        let claims = self.validate_id_token(&provider, &id_token, discovery.jwks_uri.as_deref()).await?;

        Ok(SsoUser {
            external_id: claims.sub,
            email: claims.email.clone().unwrap_or_default(),
            display_name: claims.name.clone()
                .unwrap_or_else(|| claims.email.clone().unwrap_or_else(|| "SSO user".into())),
            provider_id: provider_id.to_string(),
            roles: claims.groups.unwrap_or_default(),
            tenant_id: claims.tid.or(claims.tenant_id),
        })
    }

    /// Authenticate via LDAP bind against the first configured LDAP server.
    pub async fn ldap_auth(&self, username: &str, password: &str) -> Result<SsoUser> {
        let config = {
            let configs = self.ldap_configs.read().await;
            configs.first()
                .cloned()
                .ok_or_else(|| anyhow!("No LDAP server configured"))?
        };
        let user = ldap_authenticate(&config, username, password).await?;
        Ok(user)
    }

    /// List all configured providers
    pub async fn list_providers(&self) -> Vec<SsoProvider> {
        self.providers.read().await.values().cloned().collect()
    }

    // ---- internals ----

    async fn discovery(&self, provider: &SsoProvider) -> Result<Discovery> {
        let url = format!("{}/.well-known/openid-configuration", provider.issuer_url.trim_end_matches('/'));
        let resp = self.http.get(&url).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("OIDC discovery failed ({}): {}", status, body));
        }
        resp.json().await.map_err(Into::into)
    }

    async fn validate_id_token(
        &self,
        provider: &SsoProvider,
        id_token: &str,
        jwks_uri: Option<&str>,
    ) -> Result<Claims> {
        let parts: Vec<&str> = id_token.split('.').collect();
        if parts.len() != 3 {
            bail!("Malformed id_token");
        }
        let header_bytes = b64url_decode(parts[0])?;
        let header: JwtHeader = serde_json::from_slice(&header_bytes)?;
        let alg = header.alg.clone().unwrap_or_default();

        let key = match alg.as_str() {
            "RS256" => {
                let jwks_uri = jwks_uri
                    .ok_or_else(|| anyhow!("No jwks_uri available for RS256 validation"))?;
                let jwks: Jwks = self.http.get(jwks_uri).send().await?.json().await?;
                let jwk = jwks.keys.iter()
                    .find(|k| match (&header.kid, &k.kid) {
                        (Some(want), Some(have)) => want == have,
                        _ => true,
                    })
                    .ok_or_else(|| anyhow!("No JWK matches id_token kid"))?;
                if jwk.kty != "RSA" {
                    bail!("Unsupported JWK key type: {}", jwk.kty);
                }
                let n = jwk.n.as_deref().ok_or_else(|| anyhow!("JWK missing modulus"))?;
                let e = jwk.e.as_deref().ok_or_else(|| anyhow!("JWK missing exponent"))?;
                let pem = jwk_rsa_to_pem(n, e)?;
                DecodingKey::from_rsa_pem(pem.as_bytes())?
            }
            "HS256" => DecodingKey::from_secret(provider.encrypted_client_secret.as_bytes()),
            other => bail!("Unsupported id_token alg: {}", other),
        };

        let mut validation = match alg.as_str() {
            "RS256" => Validation::new(Algorithm::RS256),
            _ => Validation::new(Algorithm::HS256),
        };
        validation.set_audience(&[provider.client_id.as_str()]);
        if !provider.issuer_url.is_empty() {
            validation.set_issuer(&[provider.issuer_url.trim_end_matches('/')]);
        }

        let data = jsonwebtoken::decode::<Claims>(id_token, &key, &validation)?;
        Ok(data.claims)
    }
}

// ---- LDAP (via ldap3) ----

async fn ldap_authenticate(cfg: &LdapConfig, username: &str, password: &str) -> Result<SsoUser> {
    use ldap3::{LdapConnAsync, Scope, SearchEntry};

    // TLS is selected by the URL scheme (ldaps://).
    let url = if cfg.url.starts_with("ldap://") || cfg.url.starts_with("ldaps://") {
        cfg.url.clone()
    } else if cfg.tls {
        format!("ldaps://{}", cfg.url)
    } else {
        format!("ldap://{}", cfg.url)
    };

    let (conn, mut ldap) = LdapConnAsync::new(&url).await?;
    ldap3::drive!(conn);

    // Bind with the service account to search for the user.
    ldap.simple_bind(&cfg.bind_dn, &cfg.bind_password).await?.success()?;

    // Find the user's DN.
    let filter = cfg.user_filter.replace("{}", username);
    let (rs, _) = ldap.search(&cfg.base_dn, Scope::Subtree, &filter, vec!["cn", "mail"])
        .await?.success()?;
    let entry = rs.into_iter().next()
        .ok_or_else(|| anyhow!("LDAP user not found: {}", username))?;
    let entry = SearchEntry::construct(entry);
    let user_dn = entry.dn.clone();

    // Re-bind as the user to verify the credentials.
    ldap.simple_bind(&user_dn, password).await?.success()?;

    // Optionally load group memberships.
    let groups = if !cfg.group_filter.is_empty() {
        let gfilter = cfg.group_filter.replace("{}", &user_dn);
        let (grs, _) = ldap.search(&cfg.base_dn, Scope::Subtree, &gfilter, vec!["cn"])
            .await?.success()?;
        grs.into_iter()
            .filter_map(|e| SearchEntry::construct(e).attrs.get("cn")?.first().cloned())
            .collect()
    } else {
        Vec::new()
    };

    let _ = ldap.unbind().await;

    Ok(SsoUser {
        external_id: user_dn,
        email: entry.attrs.get("mail")
            .and_then(|v| v.first().cloned())
            .unwrap_or_else(|| username.to_string()),
        display_name: entry.attrs.get("cn")
            .and_then(|v| v.first().cloned())
            .unwrap_or_else(|| username.to_string()),
        provider_id: "ldap".into(),
        roles: groups,
        tenant_id: None,
    })
}

// ---- helpers ----

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn b64url_decode(s: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s)
        .map_err(|_| anyhow!("invalid base64url"))
}

fn der_len(len: usize) -> Vec<u8> {
    if len < 0x80 {
        vec![len as u8]
    } else if len <= 0xFF {
        vec![0x81, len as u8]
    } else if len <= 0xFFFF {
        vec![0x82, (len >> 8) as u8, len as u8]
    } else if len <= 0xFF_FFFF {
        vec![0x83, (len >> 16) as u8, (len >> 8) as u8, len as u8]
    } else {
        vec![0x84, (len >> 24) as u8, (len >> 16) as u8, (len >> 8) as u8, len as u8]
    }
}

fn der_integer(bytes: &[u8]) -> Vec<u8> {
    let mut b = bytes;
    while b.len() > 1 && b[0] == 0 {
        b = &b[1..];
    }
    let mut out = Vec::with_capacity(b.len() + 4);
    out.push(0x02); // INTEGER
    if b[0] & 0x80 != 0 {
        out.extend(der_len(b.len() + 1));
        out.push(0x00);
    } else {
        out.extend(der_len(b.len()));
    }
    out.extend_from_slice(b);
    out
}

fn der_sequence(children: &[Vec<u8>]) -> Vec<u8> {
    let mut body = Vec::new();
    for c in children {
        body.extend_from_slice(c);
    }
    let mut out = vec![0x30]; // SEQUENCE
    out.extend(der_len(body.len()));
    out.extend(body);
    out
}

/// Convert an RSA JWK (modulus + exponent) into a PEM public key for
/// signature validation.
fn jwk_rsa_to_pem(n_b64: &str, e_b64: &str) -> Result<String> {
    let n = b64url_decode(n_b64)?;
    let e = b64url_decode(e_b64)?;

    let rsa_key = der_sequence(&[der_integer(&n), der_integer(&e)]);
    // AlgorithmIdentifier: rsaEncryption OID (1.2.840.113549.1.1.1) + NULL
    let alg = vec![
        0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
    ];
    // BIT STRING wrapping the RSAPublicKey
    let mut bit_body = vec![0x00];
    bit_body.extend_from_slice(&rsa_key);
    let mut bit_string = vec![0x03];
    bit_string.extend(der_len(bit_body.len()));
    bit_string.extend(bit_body);

    let spki = der_sequence(&[alg, bit_string]);
    let pem = format!(
        "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----\n",
        base64::engine::general_purpose::STANDARD.encode(&spki)
    );
    Ok(pem)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencode_percent_encodes() {
        assert_eq!(urlencode("a b&c=d"), "a%20b%26c%3Dd");
        assert_eq!(urlencode("openid profile"), "openid%20profile");
    }

    #[test]
    fn jwk_rsa_to_pem_builds_valid_der() {
        // n = 5 (RSA exponent), e = 65537, minimal but structurally valid.
        let pem = jwk_rsa_to_pem("BQ", "AQAB").unwrap();
        assert!(pem.starts_with("-----BEGIN PUBLIC KEY-----"));
        assert!(pem.contains("-----END PUBLIC KEY-----"));

        let key = DecodingKey::from_rsa_pem(pem.as_bytes());
        assert!(key.is_ok(), "generated PEM should parse as an RSA public key");
    }

    #[tokio::test]
    async fn ldap_auth_without_server_errors() {
        let mgr = SsoManager::new();
        let err = mgr.ldap_auth("u", "p").await.unwrap_err();
        assert!(err.to_string().contains("No LDAP server"));
    }
}
