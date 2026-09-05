use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::time::{Duration, SystemTime};
use tracing::info;

use super::{azure_bearer_token, poll_azure_resource};

const API_VERSION: &str = "2023-05-01-preview";
const OAUTH_SCOPE: &str = "https://management.azure.com/.default";
const POLL_TIMEOUT_SECS: u64 = 60;
const POLL_INTERVAL_SECS: u64 = 5;

/// Azure SQL database backup.
pub struct AzureSqlBackup {
    client: reqwest::Client,
    subscription_id: String,
    resource_group: String,
    server_name: String,
    tenant_id: String,
    client_id: String,
    client_secret: String,
}

impl AzureSqlBackup {
    /// Construct from explicit Azure credential values.
    pub fn new(
        subscription_id: String,
        resource_group: String,
        server_name: String,
        tenant_id: String,
        client_id: String,
        client_secret: String,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            subscription_id,
            resource_group,
            server_name,
            tenant_id,
            client_id,
            client_secret,
        }
    }

    /// Construct from the AZURE_* environment variables (server from AZURE_SQL_SERVER).
    pub fn new_from_env() -> Result<Self> {
        let subscription_id = std::env::var("AZURE_SUBSCRIPTION_ID")
            .map_err(|_| anyhow!("AZURE_SUBSCRIPTION_ID not set"))?;
        let resource_group = std::env::var("AZURE_RESOURCE_GROUP")
            .map_err(|_| anyhow!("AZURE_RESOURCE_GROUP not set"))?;
        let server_name =
            std::env::var("AZURE_SQL_SERVER").map_err(|_| anyhow!("AZURE_SQL_SERVER not set"))?;
        let tenant_id =
            std::env::var("AZURE_TENANT_ID").map_err(|_| anyhow!("AZURE_TENANT_ID not set"))?;
        let client_id =
            std::env::var("AZURE_CLIENT_ID").map_err(|_| anyhow!("AZURE_CLIENT_ID not set"))?;
        let client_secret = std::env::var("AZURE_CLIENT_SECRET")
            .map_err(|_| anyhow!("AZURE_CLIENT_SECRET not set"))?;
        Ok(Self::new(
            subscription_id,
            resource_group,
            server_name,
            tenant_id,
            client_id,
            client_secret,
        ))
    }

    async fn token(&self) -> Result<String> {
        azure_bearer_token(
            &self.client,
            &self.tenant_id,
            &self.client_id,
            &self.client_secret,
            OAUTH_SCOPE,
        )
        .await
    }

    fn server_url(&self) -> String {
        format!(
            "https://management.azure.com/subscriptions/{}/resourceGroups/{}/providers/Microsoft.Sql/servers/{}/",
            self.subscription_id, self.resource_group, self.server_name
        )
    }

    /// List database names in the SQL server.
    pub async fn list_databases(&self) -> Result<Vec<String>> {
        let token = self.token().await?;
        let url = format!("{}databases?api-version={API_VERSION}", self.server_url());
        let resp = self.client.get(&url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure SQL list databases failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        Ok(parse_database_names(&json))
    }

    /// Create a copy of a database. Returns the copy database resource id.
    pub async fn create_snapshot(&self, db_name: &str, copy_name: &str) -> Result<String> {
        let token = self.token().await?;
        let source_database_id = format!("{}databases/{db_name}", self.server_url());
        let url = format!(
            "{}databases/{db_name}/copy?api-version={API_VERSION}",
            self.server_url()
        );
        let body = json!({
            "properties": {
                "createMode": "Copy",
                "sourceDatabaseId": source_database_id
            }
        });
        info!("Creating Azure SQL database copy: {db_name} -> {copy_name}");
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure SQL copy failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        let copy_id = json["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{}databases/{copy_name}", self.server_url()));
        let copy_url = format!(
            "{}databases/{copy_name}?api-version={API_VERSION}",
            self.server_url()
        );
        poll_azure_resource(
            &self.client,
            &copy_url,
            &token,
            "SQL database copy",
            POLL_TIMEOUT_SECS,
            POLL_INTERVAL_SECS,
        )
        .await?;
        Ok(copy_id)
    }

    /// Export a database to a BACPAC in blob storage. Returns the operation result id.
    pub async fn export_database(
        &self,
        db_name: &str,
        storage_uri: &str,
        storage_key: &str,
        admin_login: &str,
        admin_password: &str,
    ) -> Result<String> {
        let token = self.token().await?;
        let url = format!(
            "{}databases/{db_name}/export?api-version={API_VERSION}",
            self.server_url()
        );
        let body = json!({
            "storageUri": storage_uri,
            "storageKeyType": "StorageAccessKey",
            "storageKey": storage_key,
            "administratorLogin": admin_login,
            "administratorLoginPassword": admin_password
        });
        info!("Exporting Azure SQL database: {db_name}");
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure SQL export failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        let op_id = json["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| url.clone());
        poll_sql_operation(
            &self.client,
            &op_id,
            &token,
            "SQL export",
            POLL_TIMEOUT_SECS,
            POLL_INTERVAL_SECS,
        )
        .await?;
        Ok(op_id)
    }

    /// Import a database from a BACPAC in blob storage. Returns the operation result id.
    pub async fn import_database(
        &self,
        db_name: &str,
        storage_uri: &str,
        storage_key: &str,
        admin_login: &str,
        admin_password: &str,
    ) -> Result<String> {
        let token = self.token().await?;
        let url = format!("{}import?api-version={API_VERSION}", self.server_url());
        let body = json!({
            "administratorLogin": admin_login,
            "administratorLoginPassword": admin_password,
            "operationMode": "Import",
            "storageKeyType": "StorageAccessKey",
            "storageKey": storage_key,
            "storageUri": storage_uri,
            "databaseName": db_name
        });
        info!("Importing Azure SQL database: {db_name}");
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure SQL import failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        let op_id = json["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| url.clone());
        poll_sql_operation(
            &self.client,
            &op_id,
            &token,
            "SQL import",
            POLL_TIMEOUT_SECS,
            POLL_INTERVAL_SECS,
        )
        .await?;
        Ok(op_id)
    }
}

/// Parse the ARM SQL `databases` list response into database names.
fn parse_database_names(json: &Value) -> Vec<String> {
    let mut names = Vec::new();
    let Some(items) = json.get("value").and_then(|v| v.as_array()) else {
        return names;
    };
    for item in items {
        if let Some(n) = item["name"].as_str() {
            names.push(n.to_string());
        }
    }
    names
}

/// Poll an Azure SQL import/export operation until `status == "Succeeded"`.
async fn poll_sql_operation(
    client: &reqwest::Client,
    op_id: &str,
    token: &str,
    what: &str,
    timeout_secs: u64,
    interval_secs: u64,
) -> Result<Value> {
    let url = format!("{op_id}?api-version={API_VERSION}");
    let deadline = SystemTime::now() + Duration::from_secs(timeout_secs);
    loop {
        let resp = client.get(&url).bearer_auth(token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Azure SQL GET {what} operation failed: {status} {text}");
        }
        let v: Value = serde_json::from_str(&text)?;
        let state = v["status"].as_str().unwrap_or("Unknown");
        info!("{what} status={state}");
        if state == "Succeeded" {
            return Ok(v);
        }
        if state == "Failed" {
            anyhow::bail!("Azure SQL {what} failed");
        }
        if SystemTime::now() > deadline {
            anyhow::bail!("Azure SQL {what} timed out waiting for completion");
        }
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_database_names() {
        let payload = json!({
            "value": [
                { "name": "master" },
                { "name": "appdb", "properties": {} },
                { "name": "reports" }
            ]
        });
        assert_eq!(
            parse_database_names(&payload),
            vec![
                "master".to_string(),
                "appdb".to_string(),
                "reports".to_string()
            ]
        );
    }

    #[test]
    fn test_parse_database_names_empty() {
        assert!(parse_database_names(&json!({ "value": [] })).is_empty());
        assert!(parse_database_names(&json!({})).is_empty());
    }
}
