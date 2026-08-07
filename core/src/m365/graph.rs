use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tracing::debug;

/// Aggregate counters for a backup/restore run.
#[derive(Debug, Clone, Copy, Default)]
pub struct BackupStats {
    pub items: u64,
    pub bytes: u64,
}

/// Cached OAuth2 token with its computed expiry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphAuth {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct AuthResponse {
    access_token: String,
    expires_in: u64,
    token_type: String,
}

#[derive(Debug, Deserialize)]
struct GraphPage {
    value: Vec<Value>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}

/// Microsoft Graph API client (app-only, OAuth2 client-credentials flow).
pub struct GraphClient {
    client: reqwest::Client,
    tenant_id: String,
    client_id: String,
    client_secret: String,
    token: RwLock<Option<GraphAuth>>,
}

impl Clone for GraphClient {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
            tenant_id: self.tenant_id.clone(),
            client_id: self.client_id.clone(),
            client_secret: self.client_secret.clone(),
            token: RwLock::new(self.token.read().unwrap().clone()),
        }
    }
}

impl GraphClient {
    pub fn new(tenant_id: String, client_id: String, client_secret: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            tenant_id,
            client_id,
            client_secret,
            token: RwLock::new(None),
        }
    }

    /// Authenticate with Microsoft Graph using the OAuth2 client-credentials flow.
    pub async fn authenticate(&self) -> Result<GraphAuth> {
        let url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            self.tenant_id
        );
        let body = auth_form_body(&self.tenant_id, &self.client_id, &self.client_secret);
        let resp = self
            .client
            .post(&url)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body)
            .send()
            .await
            .with_context(|| format!("OAuth2 token request failed for tenant {}", self.tenant_id))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!(
                "OAuth2 token request failed for tenant {} ({}): {}",
                self.tenant_id,
                status,
                text
            ));
        }
        let parsed: AuthResponse = serde_json::from_str(&text)
            .with_context(|| format!("Failed to parse OAuth2 token response: {}", text))?;
        let auth = GraphAuth {
            access_token: parsed.access_token,
            expires_in: parsed.expires_in,
            token_type: parsed.token_type,
            expires_at: Utc::now() + chrono::Duration::seconds(parsed.expires_in as i64),
        };
        debug!(
            "Acquired Microsoft Graph access token (expires_in={}s)",
            auth.expires_in
        );
        Ok(auth)
    }

    /// Return a valid access token, refreshing it when expired or nearly expired.
    pub async fn ensure_token(&self) -> Result<String> {
        if let Some(token) = self.cached_token() {
            return Ok(token);
        }
        let auth = self.authenticate().await?;
        let mut guard = self.token.write().unwrap();
        *guard = Some(auth);
        Ok(guard.as_ref().unwrap().access_token.clone())
    }

    fn cached_token(&self) -> Option<String> {
        let guard = self.token.read().unwrap();
        guard.as_ref().and_then(|auth| {
            if Utc::now() < auth.expires_at - chrono::Duration::seconds(60) {
                Some(auth.access_token.clone())
            } else {
                None
            }
        })
    }

    /// Perform an authenticated GET and deserialize the JSON body.
    pub async fn get<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let token = self.ensure_token().await?;
        let resp = self
            .client
            .get(url)
            .bearer_auth(&token)
            .send()
            .await
            .with_context(|| format!("Graph GET failed: {}", url))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Graph GET {} failed ({}): {}", url, status, text));
        }
        resp.json::<T>()
            .await
            .with_context(|| format!("Failed to parse Graph response for {}", url))
    }

    /// Perform an authenticated GET returning the raw JSON value.
    pub async fn get_value(&self, url: &str) -> Result<Value> {
        self.get::<Value>(url).await
    }

    /// Perform an authenticated GET returning raw bytes (binary file content).
    pub async fn get_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let token = self.ensure_token().await?;
        let resp = self
            .client
            .get(url)
            .bearer_auth(&token)
            .send()
            .await
            .with_context(|| format!("Graph GET (binary) failed: {}", url))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Graph GET {} failed ({}): {}", url, status, text));
        }
        Ok(resp
            .bytes()
            .await
            .with_context(|| format!("Failed to read Graph body for {}", url))?
            .to_vec())
    }

    /// Fetch all items across paginated results, following `@odata.nextLink`.
    pub async fn get_all<T: DeserializeOwned>(&self, url: &str) -> Result<Vec<T>> {
        let mut items = Vec::new();
        let mut next: Option<String> = Some(url.to_string());
        while let Some(page_url) = next {
            let page: GraphPage = self.get(&page_url).await?;
            for value in page.value {
                items.push(
                    serde_json::from_value::<T>(value)
                        .with_context(|| format!("Failed to parse Graph item from {}", page_url))?,
                );
            }
            next = page.next_link;
        }
        Ok(items)
    }

    /// Perform an authenticated POST with a JSON body and return the JSON response.
    pub async fn post_json(&self, url: &str, body: &Value) -> Result<Value> {
        let token = self.ensure_token().await?;
        let resp = self
            .client
            .post(url)
            .bearer_auth(&token)
            .json(body)
            .send()
            .await
            .with_context(|| format!("Graph POST failed: {}", url))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Graph POST {} failed ({}): {}", url, status, text));
        }
        resp.json::<Value>()
            .await
            .with_context(|| format!("Failed to parse Graph response for {}", url))
    }

    /// Perform an authenticated PUT with a raw binary body.
    pub async fn put_binary(&self, url: &str, data: Vec<u8>) -> Result<()> {
        let token = self.ensure_token().await?;
        let resp = self
            .client
            .put(url)
            .bearer_auth(&token)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(data)
            .send()
            .await
            .with_context(|| format!("Graph PUT failed: {}", url))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Graph PUT {} failed ({}): {}", url, status, text));
        }
        Ok(())
    }

    /// Perform an authenticated DELETE request.
    pub async fn delete(&self, url: &str) -> Result<()> {
        let token = self.ensure_token().await?;
        let resp = self
            .client
            .delete(url)
            .bearer_auth(&token)
            .send()
            .await
            .with_context(|| format!("Graph DELETE failed: {}", url))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Graph DELETE {} failed ({}): {}", url, status, text));
        }
        Ok(())
    }
}

/// Encode a value for use in an `application/x-www-form-urlencoded` body.
fn form_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Build the OAuth2 client-credentials request body for Microsoft Graph.
pub fn auth_form_body(_tenant_id: &str, client_id: &str, client_secret: &str) -> String {
    format!(
        "scope={}&grant_type=client_credentials&client_id={}&client_secret={}",
        form_encode("https://graph.microsoft.com/.default"),
        form_encode(client_id),
        form_encode(client_secret)
    )
}

/// Percent-encode each path segment of a drive-relative path for use in a Graph URL.
pub fn url_encode_path(relative: &str) -> String {
    relative
        .split('/')
        .map(|seg| {
            let mut out = String::new();
            for b in seg.bytes() {
                match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        out.push(b as char)
                    }
                    _ => out.push_str(&format!("%{:02X}", b)),
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Collect directories (top-down) and files under `dir` into the given buffers.
pub fn walk_local(dir: &Path, dirs: &mut Vec<PathBuf>, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path.clone());
            walk_local(&path, dirs, files);
        } else {
            files.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_form_body_encodes_scope_and_secret() {
        let body = auth_form_body("tenant-123", "client-id", "secret!@#");
        assert!(body.contains("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default"));
        assert!(body.contains("grant_type=client_credentials"));
        assert!(body.contains("client_id=client-id"));
        assert!(body.contains("client_secret=secret%21%40%23"));
    }

    #[test]
    fn url_encode_path_encodes_segments() {
        assert_eq!(url_encode_path("a/b c/d&e.txt"), "a/b%20c/d%26e.txt");
        assert_eq!(url_encode_path("plain.txt"), "plain.txt");
    }

    #[test]
    fn graph_page_deserializes_value_and_next_link() {
        let with_next: GraphPage = serde_json::from_str(
            r#"{"value":[{"id":"1"},{"id":"2"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/users?$skip=2"}"#,
        )
        .unwrap();
        assert_eq!(with_next.value.len(), 2);
        assert!(with_next.next_link.is_some());

        let no_next: GraphPage = serde_json::from_str(r#"{"value":[]}"#).unwrap();
        assert!(no_next.value.is_empty());
        assert!(no_next.next_link.is_none());
    }
}
