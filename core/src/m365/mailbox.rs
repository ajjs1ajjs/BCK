use crate::m365::graph::{BackupStats, GraphClient};
use anyhow::{Context, Result};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tracing::{debug, info};

/// Exchange Online mailbox backup.
pub struct MailboxBackup {
    client: GraphClient,
}

impl MailboxBackup {
    pub fn new(client: GraphClient) -> Self {
        Self { client }
    }

    /// List all mailboxes in the tenant.
    pub async fn list_mailboxes(&self) -> Result<Vec<MailboxInfo>> {
        let url = "https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,mail&$top=999";
        let users: Vec<MailboxModel> = self.client.get_all(url).await?;
        let mailboxes = users
            .into_iter()
            .map(|u| MailboxInfo {
                id: u.id,
                display_name: u.display_name,
                email: u.mail.unwrap_or_else(|| u.user_principal_name.unwrap_or_default()),
                total_items: 0,
                total_size: 0,
            })
            .collect();
        Ok(mailboxes)
    }

    /// Back up all messages of a mailbox to `backup_dir`.
    pub async fn backup_mailbox(&self, user_id: &str, backup_dir: &Path) -> Result<BackupStats> {
        info!("Backing up mailbox: {}", user_id);
        self.backup_mailbox_inner(user_id, backup_dir, None).await
    }

    /// Back up messages received at or after `since` (unix seconds) to a temp dir.
    pub async fn backup_incremental(&self, user_id: &str, since: i64) -> Result<BackupStats> {
        info!("Incremental mailbox backup: {} since {}", user_id, since);
        let backup_dir = std::env::temp_dir()
            .join("bck-m365")
            .join("incremental")
            .join(sanitize_filename(user_id));
        self.backup_mailbox_inner(user_id, &backup_dir, Some(since))
            .await
    }

    async fn backup_mailbox_inner(
        &self,
        user_id: &str,
        backup_dir: &Path,
        since: Option<i64>,
    ) -> Result<BackupStats> {
        std::fs::create_dir_all(backup_dir).with_context(|| {
            format!(
                "Failed to create backup dir: {}",
                backup_dir.display()
            )
        })?;
        let folders_url = format!(
            "https://graph.microsoft.com/v1.0/users/{}/mailFolders?$select=id,displayName",
            user_id
        );
        let folders: Vec<FolderModel> = self.client.get_all(&folders_url).await?;
        let mut stats = BackupStats::default();
        for folder in folders {
            let safe = sanitize_filename(&folder.display_name);
            let folder_dir = backup_dir.join(&safe);
            std::fs::create_dir_all(&folder_dir).with_context(|| {
                format!("Failed to create folder dir: {}", folder_dir.display())
            })?;
            let messages_url = format!(
                "https://graph.microsoft.com/v1.0/users/{}/mailFolders/{}/messages?$top=999&$select=id,subject,from,toRecipients,ccRecipients,body,hasAttachments,receivedDateTime,sentDateTime,isRead,internetMessageId",
                user_id, folder.id
            );
            let messages: Vec<Value> = self.client.get_all(&messages_url).await?;
            debug!(
                "Mailbox {} folder {}: {} messages",
                user_id,
                folder.display_name,
                messages.len()
            );
            let mut index = 0u64;
            for msg in messages.iter() {
                if let Some(cutoff) = since {
                    let received = msg["receivedDateTime"].as_str().unwrap_or_default();
                    let ts = DateTime::parse_from_rfc3339(received).ok();
                    // Unparseable dates are skipped for incremental backups.
                    match ts {
                        Some(t) if t.timestamp() >= cutoff => {}
                        _ => continue,
                    }
                }
                let msg_id = msg["id"].as_str().unwrap_or_default();
                let file_name = format!("msg-{}-{}.json", index, sanitize_filename(msg_id));
                let file_path = folder_dir.join(file_name);
                let pretty = serde_json::to_string_pretty(msg)
                    .with_context(|| format!("Failed to serialize message {}", msg_id))?;
                std::fs::write(&file_path, &pretty)
                    .with_context(|| format!("Failed to write {}", file_path.display()))?;
                stats.items += 1;
                stats.bytes += pretty.len() as u64;
                index += 1;
            }
        }
        info!(
            "Mailbox {} backed up: {} items, {} bytes",
            user_id, stats.items, stats.bytes
        );
        Ok(stats)
    }

    /// Restore messages from `backup_dir` back into the mailbox.
    pub async fn restore_mailbox(&self, user_id: &str, backup_dir: &Path) -> Result<u64> {
        info!("Restoring mailbox: {} from {}", user_id, backup_dir.display());
        let mut restored = 0u64;
        let url = format!("https://graph.microsoft.com/v1.0/users/{}/messages", user_id);
        for file_path in walk_json_files(backup_dir) {
            let raw = std::fs::read_to_string(&file_path)
                .with_context(|| format!("Failed to read {}", file_path.display()))?;
            let v: Value = serde_json::from_str(&raw)
                .with_context(|| format!("Failed to parse {}", file_path.display()))?;
            let payload = serde_json::json!({
                "subject": v.get("subject").cloned().unwrap_or(Value::Null),
                "body": {
                    "contentType": "text",
                    "content": v.get("body")
                        .and_then(|b| b.get("content"))
                        .cloned()
                        .unwrap_or(Value::Null),
                },
                "toRecipients": v.get("toRecipients").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
                "isRead": v.get("isRead").cloned().unwrap_or(Value::Bool(false)),
            });
            self.client.post_json(&url, &payload).await?;
            restored += 1;
        }
        info!("Mailbox {} restored: {} messages", user_id, restored);
        Ok(restored)
    }
}

#[derive(Debug, Deserialize)]
struct MailboxModel {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "userPrincipalName", default)]
    user_principal_name: Option<String>,
    #[serde(default)]
    mail: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FolderModel {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
}

/// Replace characters that are unsafe in file names with `_`.
pub fn sanitize_filename(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
            out.push('_');
        } else {
            out.push(c);
        }
    }
    out
}

/// Recursively find all `*.json` files under `dir`.
pub fn walk_json_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().map(|e| e == "json").unwrap_or(false) {
                out.push(path);
            }
        }
    }
    walk(dir, &mut out);
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxInfo {
    pub id: String,
    pub display_name: String,
    pub email: String,
    pub total_items: u64,
    pub total_size: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn sanitize_filename_replaces_unsafe_chars() {
        assert_eq!(
            sanitize_filename("a/b\\c:d*e?f\"g<h>i|j"),
            "a_b_c_d_e_f_g_h_i_j"
        );
        assert_eq!(sanitize_filename("normal-name.txt"), "normal-name.txt");
        assert!(sanitize_filename("line\nbreak").contains('_'));
    }

    #[test]
    fn walk_json_files_finds_nested_json() {
        let base = std::env::temp_dir().join(format!("bck-m365-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(base.join("Inbox").join("sub")).unwrap();
        fs::write(base.join("a.json"), "{}").unwrap();
        fs::write(base.join("Inbox").join("b.json"), "{}").unwrap();
        fs::write(base.join("Inbox").join("sub").join("c.json"), "{}").unwrap();
        fs::write(base.join("Inbox").join("note.txt"), "hi").unwrap();
        let files = walk_json_files(&base);
        assert_eq!(files.len(), 3);
        fs::remove_dir_all(&base).unwrap();
    }
}
