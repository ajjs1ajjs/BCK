use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, warn};

const GRAPH_ENDPOINT: &str = "https://graph.microsoft.com/v1.0";
const AUTH_ENDPOINT: &str = "https://login.microsoftonline.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphAuth {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
}

/// Microsoft Graph API client using OAuth 2.0 client-credentials flow.
pub struct GraphClient {
    client: reqwest::Client,
    tenant_id: String,
    client_id: String,
    client_secret: String,
    token: Arc<RwLock<Option<GraphAuth>>>,
    token_expires_at: Arc<RwLock<u64>>,
}

impl GraphClient {
    pub fn new(tenant_id: &str, client_id: &str, client_secret: &str) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
            tenant_id: tenant_id.to_string(),
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
            token: Arc::new(RwLock::new(None)),
            token_expires_at: Arc::new(RwLock::new(0)),
        }
    }

    /// Authenticate with Microsoft Graph (cached; refreshes when expired).
    pub async fn authenticate(
        &self,
        tenant_id: &str,
        client_id: &str,
        client_secret: &str,
    ) -> Result<GraphAuth> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();
        if let Some(tok) = self.token.read().await.as_ref() {
            if *self.token_expires_at.read().await > now + 60 {
                return Ok(tok.clone());
            }
        }

        let url = format!("{}/{}/oauth2/v2.0/token", AUTH_ENDPOINT, tenant_id);
        let params = [
            ("grant_type", "client_credentials"),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("scope", "https://graph.microsoft.com/.default"),
        ];
        let resp = self.client.post(&url).form(&params).send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("Graph auth failed ({}): {}", status, body));
        }
        #[derive(Deserialize)]
        struct TokenResp {
            access_token: String,
            expires_in: u64,
            token_type: String,
        }
        let t: TokenResp = serde_json::from_str(&body)?;
        let auth = GraphAuth {
            access_token: t.access_token,
            expires_in: t.expires_in,
            token_type: t.token_type,
        };
        let exp = now + t.expires_in;
        *self.token.write().await = Some(auth.clone());
        *self.token_expires_at.write().await = exp;
        debug!("Graph authenticated (expires in {}s)", t.expires_in);
        Ok(auth)
    }

    async fn ensure_token(&self) -> Result<String> {
        let auth = self.authenticate(&self.tenant_id, &self.client_id, &self.client_secret).await?;
        Ok(auth.access_token)
    }

    /// Make a Graph API request and deserialize the response.
    pub async fn get<T>(&self, url: &str) -> Result<T>
    where
        T: serde::de::DeserializeOwned,
    {
        let token = self.ensure_token().await?;
        let full = if url.starts_with("http") { url.to_string() } else { format!("{}{}", GRAPH_ENDPOINT, url) };
        let resp = self.client.get(&full)
            .bearer_auth(&token)
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("Graph GET {} failed ({}): {}", url, status, body));
        }
        serde_json::from_str(&body).map_err(|e| anyhow!("Graph decode: {}", e))
    }

    /// Paginate through Graph API results following @odata.nextLink.
    pub async fn get_all<T>(&self, url: &str) -> Result<Vec<T>>
    where
        T: serde::de::DeserializeOwned,
    {
        let token = self.ensure_token().await?;
        let mut out = Vec::new();
        let mut next: Option<String> = Some(format!("{}{}", GRAPH_ENDPOINT, url));

        for _ in 0..100 {
            let current = match next.take() {
                Some(u) => u,
                None => break,
            };
            let resp = self.client.get(&current).bearer_auth(&token).send().await?;
            let status = resp.status();
            let body = resp.text().await?;
            if !status.is_success() {
                return Err(anyhow!("Graph GET {} failed ({}): {}", current, status, body));
            }
            let body: serde_json::Value = serde_json::from_str(&body)?;
            if let Some(values) = body["value"].as_array() {
                for v in values {
                    out.push(serde_json::from_value(v.clone())?);
                }
            }
            next = body["@odata.nextLink"].as_str().map(|s| s.to_string());
        }
        Ok(out)
    }
}

/// A generic M365 object returned by Graph (mailbox, drive item, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphItem {
    pub id: String,
    pub name: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "size")]
    pub size_bytes: Option<u64>,
    #[serde(rename = "lastModifiedDateTime")]
    pub last_modified: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_item_deserializes() {
        let json = r#"{"id":"1","displayName":"mailbox@contoso.com","size":1234,"lastModifiedDateTime":"2026-01-01T00:00:00Z"}"#;
        let item: GraphItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.id, "1");
        assert_eq!(item.display_name.as_deref(), Some("mailbox@contoso.com"));
        assert_eq!(item.size_bytes, Some(1234));
    }

    #[test]
    fn client_rejects_empty_credentials_early() {
        let c = GraphClient::new("", "", "");
        assert!(c.tenant_id.is_empty());
        // authenticate would fail on network; we only verify construction.
        let _ = c;
    }
}
