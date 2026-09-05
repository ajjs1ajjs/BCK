use crate::m365::graph::{url_encode_path, walk_local, BackupStats, GraphClient};
use crate::m365::mailbox::sanitize_filename;
use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;
use std::path::Path;
use tracing::{debug, info};

/// OneDrive for Business backup.
pub struct OneDriveBackup {
    client: GraphClient,
}

impl OneDriveBackup {
    pub fn new(client: GraphClient) -> Self {
        Self { client }
    }

    /// List the caller's root drive children.
    pub async fn list_my_files(&self) -> Result<Vec<DriveItem>> {
        let url = "https://graph.microsoft.com/v1.0/me/drive/root/children";
        self.client.get_all(url).await
    }

    /// Back up a user's entire OneDrive drive to `backup_dir`.
    pub async fn backup_drive(&self, user_id: &str, backup_dir: &Path) -> Result<BackupStats> {
        info!("Backing up OneDrive for user: {}", user_id);
        std::fs::create_dir_all(backup_dir)?;
        let mut stats = BackupStats::default();
        let root_url = format!(
            "https://graph.microsoft.com/v1.0/users/{}/drive/root/children",
            user_id
        );
        self.walk_folder(user_id, &root_url, backup_dir, &mut stats)
            .await?;
        info!(
            "OneDrive for {} backed up: {} items, {} bytes",
            user_id, stats.items, stats.bytes
        );
        Ok(stats)
    }

    async fn walk_folder(
        &self,
        user_id: &str,
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
                        "https://graph.microsoft.com/v1.0/users/{}/drive/items/{}/children",
                        user_id, item.id
                    );
                    stack.push((child_url, child_dir));
                } else {
                    let content_url = format!(
                        "https://graph.microsoft.com/v1.0/users/{}/drive/items/{}/content",
                        user_id, item.id
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

    /// Restore files from `backup_dir` into the user's OneDrive drive.
    pub async fn restore_drive(&self, user_id: &str, backup_dir: &Path) -> Result<u64> {
        info!("Restoring OneDrive: {} -> {}", user_id, backup_dir.display());
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
                    "https://graph.microsoft.com/v1.0/users/{}/drive/root/children",
                    user_id
                ),
                false => format!(
                    "https://graph.microsoft.com/v1.0/users/{}/drive/root:/{}:/children",
                    user_id,
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
                "https://graph.microsoft.com/v1.0/users/{}/drive/root:/{}:/content?@microsoft.graph.conflictBehavior=replace",
                user_id,
                url_encode_path(&rel)
            );
            self.client.put_binary(&url, data).await?;
            restored += 1;
        }
        info!("OneDrive for {} restored: {} files", user_id, restored);
        Ok(restored)
    }
}

/// Return `path` relative to `base` using `/` separators (Graph drive path syntax).
pub fn relative_path(path: &Path, base: &Path) -> String {
    let rel = path.strip_prefix(base).unwrap_or(path);
    let mut parts = Vec::new();
    for comp in rel.components() {
        if let std::path::Component::Normal(c) = comp {
            parts.push(c.to_string_lossy().into_owned());
        }
    }
    parts.join("/")
}

fn deserialize_folder<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(v.is_object())
}

fn deserialize_mime_type<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<String>, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(v.get("mimeType")
        .and_then(|m| m.as_str())
        .map(str::to_owned))
}

/// A drive item (file or folder) as returned by the Graph drive API.
#[derive(Debug, Clone, Deserialize)]
pub struct DriveItem {
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "deserialize_folder")]
    pub folder: bool,
    #[serde(default)]
    pub size: u64,
    #[serde(default, rename = "file", deserialize_with = "deserialize_mime_type")]
    pub mime_type: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_path_builds_slash_path() {
        let base = Path::new("C:\\backup");
        let file = base.join("Inbox").join("sub").join("note.txt");
        assert_eq!(relative_path(&file, base), "Inbox/sub/note.txt");
        assert_eq!(relative_path(base, base), "");
    }

    #[test]
    fn drive_item_deserializes_folder_and_mime() {
        let folder: DriveItem = serde_json::from_str(
            r#"{"id":"A","name":"Docs","folder":{"childCount":2},"size":0}"#,
        )
        .unwrap();
        assert!(folder.folder);
        assert!(folder.mime_type.is_none());

        let file: DriveItem = serde_json::from_str(
            r#"{"id":"B","name":"a.pdf","size":123,"file":{"mimeType":"application/pdf"}}"#,
        )
        .unwrap();
        assert!(!file.folder);
        assert_eq!(file.size, 123);
        assert_eq!(file.mime_type.as_deref(), Some("application/pdf"));
    }
}
