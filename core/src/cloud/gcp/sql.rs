use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tracing::info;

use super::{gcp_bearer_token, poll_gcp_operation, project_id_from_env};

const OPERATION_TIMEOUT_SECS: u64 = 60;
const OPERATION_INTERVAL_SECS: u64 = 5;

/// Cloud SQL database backup via SQL export/import.
pub struct CloudSqlBackup {
    client: reqwest::Client,
    project_id: String,
    instance_id: String,
}

impl CloudSqlBackup {
    pub fn new(project_id: String, instance_id: String) -> Self {
        Self::new_with(project_id, instance_id)
    }

    pub fn new_with(project_id: String, instance_id: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            project_id,
            instance_id,
        }
    }

    /// Construct from GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT and CLOUD_SQL_INSTANCE env vars.
    pub fn new_from_env() -> Result<Self> {
        let project_id = project_id_from_env()?;
        let instance_id =
            std::env::var("CLOUD_SQL_INSTANCE").map_err(|_| anyhow!("CLOUD_SQL_INSTANCE not set"))?;
        Ok(Self::new_with(project_id, instance_id))
    }

    async fn token(&self) -> Result<String> {
        gcp_bearer_token(&self.client).await
    }

    fn base_url(&self) -> String {
        format!(
            "https://sqladmin.googleapis.com/sql/v1beta4/projects/{}/instances/{}",
            self.project_id, self.instance_id
        )
    }

    /// List all databases in the Cloud SQL instance.
    pub async fn list_databases(&self) -> Result<Vec<String>> {
        let token = self.token().await?;
        let url = format!("{}/databases?alt=json", self.base_url());
        let resp = self.client.get(&url).bearer_auth(&token).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GCP Cloud SQL list databases failed: {status} {text}");
        }
        let json: Value = serde_json::from_str(&text)?;
        Ok(parse_database_names(&json))
    }

    /// Export a database to a GCS URI. Returns the operation id.
    pub async fn export_database(&self, db: &str, gs_uri: &str) -> Result<String> {
        let token = self.token().await?;
        let url = format!("{}/export?alt=json", self.base_url());
        let body = json!({
            "exportContext": {
                "kind": "sql#exportContext",
                "fileType": "SQL",
                "uri": gs_uri,
                "databases": [db],
                "sqlExportOptions": { "schemaOnly": false }
            }
        });
        info!("Exporting Cloud SQL database {db} to {gs_uri}");
        self.post_and_poll(&token, &url, &body, "Cloud SQL export")
            .await
    }

    /// Import a database from a GCS URI. Returns the operation id.
    pub async fn import_database(&self, db: &str, gs_uri: &str) -> Result<String> {
        let token = self.token().await?;
        let url = format!("{}/import?alt=json", self.base_url());
        let body = json!({
            "importContext": {
                "kind": "sql#importContext",
                "fileType": "SQL",
                "uri": gs_uri,
                "database": db
            }
        });
        info!("Importing Cloud SQL database {db} from {gs_uri}");
        self.post_and_poll(&token, &url, &body, "Cloud SQL import")
            .await
    }

    async fn post_and_poll(&self, token: &str, url: &str, body: &Value, what: &str) -> Result<String> {
        let resp = self.client.post(url).bearer_auth(token).json(body).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GCP {what} failed: {status} {text}");
        }
        let op: Value = serde_json::from_str(&text)?;
        let op_url = op["selfLink"].as_str().map(|s| s.to_string()).unwrap_or_else(|| {
            format!(
                "https://sqladmin.googleapis.com/sql/v1beta4/projects/{}/operations/{}",
                self.project_id,
                op["name"].as_str().unwrap_or("")
            )
        });
        poll_gcp_operation(
            &self.client,
            &op_url,
            token,
            what,
            OPERATION_TIMEOUT_SECS,
            OPERATION_INTERVAL_SECS,
        )
        .await?;
        let op_id = op["name"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| op_url.clone());
        Ok(op_id)
    }
}

/// Parse the Cloud SQL `databases` list response into database names.
fn parse_database_names(json: &Value) -> Vec<String> {
    let mut names = Vec::new();
    let Some(items) = json.get("items").and_then(|i| i.as_array()) else {
        return names;
    };
    for item in items {
        if let Some(n) = item["name"].as_str() {
            names.push(n.to_string());
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_database_names() {
        let payload = json!({
            "kind": "sql#databasesList",
            "items": [
                { "name": "appdb", "kind": "sql#database" },
                { "name": "reports", "kind": "sql#database" },
                { "name": "analytics", "kind": "sql#database" }
            ]
        });
        assert_eq!(
            parse_database_names(&payload),
            vec![
                "appdb".to_string(),
                "reports".to_string(),
                "analytics".to_string()
            ]
        );
    }

    #[test]
    fn test_parse_database_names_empty() {
        assert!(parse_database_names(&json!({ "items": [] })).is_empty());
        assert!(parse_database_names(&json!({})).is_empty());
    }
}
