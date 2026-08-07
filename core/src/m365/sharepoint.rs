use crate::m365::graph::{url_encode_path, walk_local, BackupStats, GraphClient};
use crate::m365::mailbox::sanitize_filename;
use crate::m365::onedrive::{relative_path, DriveItem};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::{debug, info};

/// SharePoint Online backup.
pub struct SharePointBackup {
    client: GraphClient,
}

impl SharePointBackup {
    pub fn new(client: GraphClient) -> Self {
        Self { client }
    }

    /// List all SharePoint sites in the tenant.
    pub async fn list_sites(&self) -> Result<Vec<SiteInfo>> {
        let url = "https://graph.microsoft.com/v1.0/sites?search=*";
        let sites: Vec<SiteModel> = self.client.get_all(url).await?;
        Ok(sites
            .into_iter()
            .map(|s| SiteInfo {
                id: s.id,
                name: s.name,
                web_url: s.web_url,
            })
            .collect())
    }

    /// Back up a site's default document library to `backup_dir`.
    pub async fn backup_site(&self, site_id: &str, backup_dir: &Path) -> Result<BackupStats> {
        info!("Backing up SharePoint site: {}", site_id);
        std::fs::create_dir_all(backup_dir)?;
        let mut stats = BackupStats::default();
        let root_url = format!(
            "https://graph.microsoft.com/v1.0/sites/{}/drive/root/children",
            site_id
        );
        self.walk_folder(site_id, &root_url, backup_dir, &mut stats)
            .await?;
        info!(
            "SharePoint site {} backed up: {} items, {} bytes",
            site_id, stats.items, stats.bytes
        );
        Ok(stats)
    }

    async fn walk_folder(
        &self,
        site_id: &str,
        root_url: &str,
        root_dir: &Path,
        stats: &mut BackupStats,
    ) -> Result<()> {
        let mut stack: Vec<(String, std::path::PathBuf)> =
            vec![(root_url.to_string(), root_dir.to_path_buf())];
        while let Some((children_url, dir)) = stack.pop() {
            let items: Vec<DriveItem> = self.client.get_all(&children_url).await?;
            for item in items {
                let safe = sanitize_filename(&item.name);
                if item.folder {
                    let child_dir = dir.join(&safe);
                    std::fs::create_dir_all(&child_dir)
                        .with_context(|| format!("Failed to create dir: {}", child_dir.display()))?;
                    let child_url = format!(
                        "https://graph.microsoft.com/v1.0/sites/{}/drive/items/{}/children",
                        site_id, item.id
                    );
                    stack.push((child_url, child_dir));
                } else {
                    let content_url = format!(
                        "https://graph.microsoft.com/v1.0/sites/{}/drive/items/{}/content",
                        site_id, item.id
                    );
                    let bytes = self.client.get_bytes(&content_url).await?;
                    std::fs::write(dir.join(&safe), &bytes)
                        .with_context(|| format!("Failed to write {}", safe))?;
                    stats.items += 1;
                    stats.bytes += bytes.len() as u64;
                }
            }
        }
        Ok(())
    }

    /// Restore files from `backup_dir` back into a site's default document library.
    pub async fn restore_site(&self, site_id: &str, backup_dir: &Path) -> Result<u64> {
        info!(
            "Restoring SharePoint site: {} -> {}",
            site_id,
            backup_dir.display()
        );
        if !backup_dir.is_dir() {
            return Ok(0);
        }
        let mut dirs = Vec::new();
        let mut files = Vec::new();
        walk_local(backup_dir, &mut dirs, &mut files);
        for dir in &dirs {
            let name = dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let parent = relative_path(dir.parent().unwrap_or(backup_dir), backup_dir);
            let url = match parent.is_empty() {
                true => format!(
                    "https://graph.microsoft.com/v1.0/sites/{}/drive/root/children",
                    site_id
                ),
                false => format!(
                    "https://graph.microsoft.com/v1.0/sites/{}/drive/root:/{}:/children",
                    site_id,
                    url_encode_path(&parent)
                ),
            };
            let payload = serde_json::json!({ "name": name, "folder": {} });
            if let Err(e) = self.client.post_json(&url, &payload).await {
                // Ignore 409 conflicts (folder already exists).
                if !e.to_string().contains("409") {
                    debug!("Failed to create folder {} (ignored): {}", name, e);
                }
            }
        }
        let mut restored = 0u64;
        for file in &files {
            let data = std::fs::read(file)
                .with_context(|| format!("Failed to read {}", file.display()))?;
            let rel = relative_path(file, backup_dir);
            let url = format!(
                "https://graph.microsoft.com/v1.0/sites/{}/drive/root:/{}:/content?@microsoft.graph.conflictBehavior=replace",
                site_id,
                url_encode_path(&rel)
            );
            self.client.put_binary(&url, data).await?;
            restored += 1;
        }
        info!("SharePoint site {} restored: {} files", site_id, restored);
        Ok(restored)
    }
}

#[derive(Debug, Deserialize)]
struct SiteModel {
    id: String,
    name: String,
    #[serde(rename = "webUrl")]
    web_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteInfo {
    pub id: String,
    pub name: String,
    pub web_url: String,
}
