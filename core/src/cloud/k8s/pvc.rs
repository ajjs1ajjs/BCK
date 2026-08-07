use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::env;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tracing::info;

/// PVC backup — snapshots persistent volume data via VolumeSnapshots.
pub struct PvcBackup {
    context: Option<String>,
}

impl PvcBackup {
    /// Create a PVC backup using the context from env `BCK_K8S_CONTEXT` (if set).
    pub fn new() -> Self {
        let ctx = env::var("BCK_K8S_CONTEXT").unwrap_or_default();
        Self {
            context: if ctx.is_empty() { None } else { Some(ctx) },
        }
    }

    /// Create a PVC backup pinned to a specific kubeconfig context.
    pub fn new_with_context(ctx: &str) -> Self {
        Self {
            context: if ctx.is_empty() {
                None
            } else {
                Some(ctx.to_string())
            },
        }
    }

    /// Backup PVC data by creating a VolumeSnapshot named `bck-{pvc_name}`.
    pub async fn backup_pvc(&self, namespace: &str, pvc_name: &str) -> Result<()> {
        let snapshot_name = format!("bck-{}", pvc_name);
        self.snapshot_pvc(namespace, pvc_name, &snapshot_name).await?;
        Ok(())
    }

    /// Restore a PVC from a VolumeSnapshot.
    pub async fn restore_pvc(
        &self,
        namespace: &str,
        snapshot_name: &str,
        new_pvc_name: &str,
    ) -> Result<()> {
        let yaml = format!(
            "apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: {}\nspec:\n  dataSource:\n    apiGroup: snapshot.storage.k8s.io\n    kind: VolumeSnapshot\n    name: {}\n  accessModes:\n    - ReadWriteOnce\n  resources:\n    requests:\n      storage: 1Gi\n",
            new_pvc_name, snapshot_name
        );
        self.apply_stdin(&yaml).await?;
        info!("Restored PVC {}/{} from snapshot {}", namespace, new_pvc_name, snapshot_name);
        Ok(())
    }

    /// List PVCs in a namespace.
    pub async fn list_pvcs(&self, namespace: &str) -> Result<Vec<String>> {
        let out = self
            .run_kubectl(&["get", "pvc", "-n", namespace, "-o", "json"])
            .await?;
        let doc: Value = serde_json::from_str(&out).context("failed to parse kubectl pvc output")?;
        Ok(extract_names(&doc))
    }

    /// List VolumeSnapshots in a namespace.
    pub async fn list_snapshots(&self, namespace: &str) -> Result<Vec<String>> {
        let out = self
            .run_kubectl(&["get", "volumesnapshot", "-n", namespace, "-o", "json"])
            .await?;
        let doc: Value = serde_json::from_str(&out).context("failed to parse kubectl snapshot output")?;
        Ok(extract_names(&doc))
    }

    /// Create a VolumeSnapshot for the given PVC.
    pub async fn snapshot_pvc(
        &self,
        namespace: &str,
        pvc_name: &str,
        snapshot_name: &str,
    ) -> Result<String> {
        let vs_class = env::var("BCK_K8S_VSCLASS").unwrap_or_default();
        let mut yaml = format!(
            "apiVersion: snapshot.storage.k8s.io/v1\nkind: VolumeSnapshot\nmetadata:\n  name: {}\n  namespace: {}\nspec:\n",
            snapshot_name, namespace
        );
        if !vs_class.is_empty() {
            yaml.push_str(&format!("  volumeSnapshotClassName: {}\n", vs_class));
        }
        yaml.push_str(&format!(
            "  source:\n    persistentVolumeClaimName: {}\n",
            pvc_name
        ));

        self.apply_stdin(&yaml).await?;
        info!("Created VolumeSnapshot {}/{}", namespace, snapshot_name);
        Ok(snapshot_name.to_string())
    }

    /// Get the full PVC manifest as YAML (for restore reference).
    pub async fn get_pvc_manifest(&self, namespace: &str, pvc_name: &str) -> Result<String> {
        self.run_kubectl(&["get", "pvc", pvc_name, "-n", namespace, "-o", "yaml"]).await
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

/// Extract `metadata.name` from every item of a `kubectl get -o json` document.
pub fn extract_names(doc: &Value) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(items) = doc.get("items").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(name) = item.pointer("/metadata/name").and_then(|n| n.as_str()) {
                names.push(name.to_string());
            }
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_names_returns_metadata_names() {
        let doc = json!({
            "items": [
                {"metadata": {"name": "data-pvc"}},
                {"metadata": {"name": "logs-pvc"}},
                {"metadata": {}}
            ]
        });
        assert_eq!(extract_names(&doc), vec!["data-pvc", "logs-pvc"]);
    }

    #[test]
    fn extract_names_handles_missing_items() {
        assert!(extract_names(&json!({"kind": "List"})).is_empty());
    }

    #[test]
    fn new_with_context_ignores_empty_string() {
        assert!(PvcBackup::new_with_context("").context.is_none());
        assert_eq!(PvcBackup::new_with_context("dev").context.as_deref(), Some("dev"));
    }
}
