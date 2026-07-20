use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;

use crate::types::FileMetadata;

#[async_trait]
pub trait FileScanner: Send + Sync {
    async fn scan(&self, path: &str) -> Result<ScanResult>;
    async fn scan_incremental(&self, path: &str, since: i64) -> Result<ScanResult>;
}

#[derive(Debug, Default)]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    pub total_size: u64,
    pub file_count: u64,
    pub directories: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub path: PathBuf,
    pub relative_path: String,
    pub metadata: FileMetadata,
    pub checksum: Option<String>,
}

pub struct LocalFileScanner;

#[async_trait]
impl FileScanner for LocalFileScanner {
    async fn scan(&self, path: &str) -> Result<ScanResult> {
        let root = PathBuf::from(path);
        let mut result = ScanResult::default();

        let mut entries = Vec::new();
        let mut dirs = Vec::new();
        collect_entries(&root, &root, &mut entries, &mut dirs)?;

        result.files = entries;
        result.file_count = result.files.len() as u64;
        result.total_size = result.files.iter().map(|f| f.metadata.size).sum();
        result.directories = dirs;

        Ok(result)
    }

    async fn scan_incremental(&self, path: &str, since: i64) -> Result<ScanResult> {
        let mut result = self.scan(path).await?;
        result.files.retain(|f| f.metadata.modified_time > since);
        result.file_count = result.files.len() as u64;
        result.total_size = result.files.iter().map(|f| f.metadata.size).sum();
        Ok(result)
    }
}

fn collect_entries(
    root: &PathBuf,
    dir: &PathBuf,
    entries: &mut Vec<ScannedFile>,
    dirs: &mut Vec<String>,
) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }

    let read_dir = std::fs::read_dir(dir)?;
    for entry in read_dir {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(root)
            .map_err(|e| anyhow::anyhow!("strip prefix error: {}", e))?
            .to_string_lossy()
            .to_string();

        if path.is_dir() {
            dirs.push(relative);
            collect_entries(root, &path, entries, dirs)?;
        } else if path.is_file() {
            let metadata = std::fs::metadata(&path)?;
            let fmeta = FileMetadata {
                path: path.to_string_lossy().to_string(),
                size: metadata.len(),
                modified_time: metadata.modified()
                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
                    .unwrap_or(0),
                mode: 0,
                owner: String::new(),
                group: String::new(),
                extended_attributes: std::collections::HashMap::new(),
                acl: Vec::new(),
            };

            entries.push(ScannedFile {
                path,
                relative_path: relative,
                metadata: fmeta,
                checksum: None,
            });
        }
    }

    Ok(())
}

pub fn create_scanner(scanner_type: &str) -> Box<dyn FileScanner> {
    match scanner_type {
        _ => Box::new(LocalFileScanner),
    }
}
