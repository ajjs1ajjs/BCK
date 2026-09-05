use crate::cloud::k8s::resources::K8sResourceManifest;
use anyhow::{bail, Context, Result};
use std::env;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tracing::info;

/// K8s restore — restores resources and PVCs from a backup.
pub struct K8sRestore {
    context: Option<String>,
}

impl K8sRestore {
    /// Create a restore using the context from env `BCK_K8S_CONTEXT` (if set).
    pub fn new() -> Self {
        let ctx = env::var("BCK_K8S_CONTEXT").unwrap_or_default();
        Self {
            context: if ctx.is_empty() { None } else { Some(ctx) },
        }
    }

    /// Create a restore pinned to a specific kubeconfig context.
    pub fn new_with_context(ctx: &str) -> Self {
        Self {
            context: if ctx.is_empty() {
                None
            } else {
                Some(ctx.to_string())
            },
        }
    }

    /// Restore all resources from a backup manifest into a namespace.
    pub async fn restore_resources(
        &self,
        namespace: &str,
        manifest: &K8sResourceManifest,
    ) -> Result<usize> {
        let body = serde_json::to_string(manifest).context("failed to serialize manifest")?;
        self.apply_stdin(&body).await?;
        info!("Restored {} resources into namespace {}", manifest.items.len(), namespace);
        Ok(manifest.items.len())
    }

    /// Restore resources to a different namespace (applies as-is to the target).
    pub async fn restore_to_namespace(
        &self,
        manifest: &K8sResourceManifest,
        target_namespace: &str,
    ) -> Result<usize> {
        self.restore_resources(target_namespace, manifest).await
    }

    /// Restore a specific resource from YAML/JSON into a namespace.
    pub async fn restore_resource(
        &self,
        kind: &str,
        name: &str,
        namespace: &str,
        body: &str,
    ) -> Result<()> {
        self.apply_stdin(body).await?;
        info!("Restored K8s resource: {}/{}/{}", kind, namespace, name);
        Ok(())
    }

    /// Restore every manifest file found (recursively) under `backup_dir`.
    pub async fn restore_from_directory(
        &self,
        namespace: &str,
        backup_dir: &str,
    ) -> Result<usize> {
        let mut files = Vec::new();
        collect_manifest_files(Path::new(backup_dir), &mut files);

        let mut applied = 0usize;
        for file in files {
            let file_str = file.to_string_lossy().into_owned();
            match self
                .run_kubectl(&["apply", "-n", namespace, "-f", file_str.as_str()])
                .await
            {
                Ok(_) => applied += 1,
                Err(e) => tracing::warn!("failed to apply {}: {}", file_str, e),
            }
        }
        info!("Restored {} files from {} into namespace {}", applied, backup_dir, namespace);
        Ok(applied)
    }

    /// Run `kubectl` (with `--context` when a context is set) and capture output.
    async fn run_kubectl(&self, args: &[&str]) -> Result<String> {
        let mut cmd = Command::new("kubectl");
        if let Some(ctx) = &self.context {
            cmd.arg("--context").arg(ctx);
        }
        cmd.args(args);
        let output = cmd
            .output()
            .await
            .with_context(|| format!("failed to execute kubectl {:?}", args))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            bail!("kubectl {:?} failed: {}", args, stderr.trim());
        }
    }

    /// Pipe a manifest to `kubectl apply -f -`.
    async fn apply_stdin(&self, body: &str) -> Result<String> {
        let mut cmd = Command::new("kubectl");
        if let Some(ctx) = &self.context {
            cmd.arg("--context").arg(ctx);
        }
        cmd.arg("apply").arg("-f").arg("-");
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().context("failed to spawn kubectl apply")?;
        let mut stdin = child
            .stdin
            .take()
            .context("failed to acquire kubectl stdin")?;
        stdin
            .write_all(body.as_bytes())
            .await
            .context("failed to write manifest to kubectl stdin")?;
        drop(stdin);

        let output = child
            .wait_with_output()
            .await
            .context("failed to wait for kubectl apply")?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            bail!("kubectl apply failed: {}", stderr.trim());
        }
    }
}

/// Recursively collect `*.yaml`, `*.yml`, and `*.json` files under `dir`.
pub fn collect_manifest_files(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_manifest_files(&path, out);
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext = ext.to_ascii_lowercase();
                if ext == "yaml" || ext == "yml" || ext == "json" {
                    out.push(path);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_manifest_files_recursively_gathers_manifests() {
        let dir = std::env::temp_dir().join(format!("bck-restore-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.yaml"), "kind: ConfigMap").unwrap();
        std::fs::write(dir.join("b.yml"), "kind: Secret").unwrap();
        std::fs::write(dir.join("c.json"), "{}").unwrap();
        std::fs::write(dir.join("sub").join("d.yaml"), "kind: Pod").unwrap();
        std::fs::write(dir.join("note.txt"), "ignored").unwrap();

        let mut files = Vec::new();
        collect_manifest_files(&dir, &mut files);
        files.sort();

        let names: Vec<String> = files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a.yaml", "b.yml", "c.json", "d.yaml"]);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn collect_manifest_files_handles_missing_dir() {
        let mut files = Vec::new();
        collect_manifest_files(Path::new("no-such-dir-bck"), &mut files);
        assert!(files.is_empty());
    }

    #[test]
    fn new_with_context_ignores_empty_string() {
        assert!(K8sRestore::new_with_context("").context.is_none());
        assert_eq!(K8sRestore::new_with_context("dev").context.as_deref(), Some("dev"));
    }
}
