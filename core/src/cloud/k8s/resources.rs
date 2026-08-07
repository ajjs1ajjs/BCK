use anyhow::{bail, Context, Result};
use futures::future::try_join_all;
use serde::{Deserialize, Serialize};
use std::env;
use tracing::info;

/// Kubernetes resource backup — exports JSON manifests for all resource types
pub struct K8sResourceBackup {
    context: Option<String>,
}

impl K8sResourceBackup {
    /// Create a resource backup using the context from env `BCK_K8S_CONTEXT` (if set).
    pub fn new() -> Self {
        let ctx = env::var("BCK_K8S_CONTEXT").unwrap_or_default();
        Self {
            context: if ctx.is_empty() { None } else { Some(ctx) },
        }
    }

    /// Create a resource backup pinned to a specific kubeconfig context.
    pub fn new_with_context(ctx: &str) -> Self {
        Self {
            context: if ctx.is_empty() {
                None
            } else {
                Some(ctx.to_string())
            },
        }
    }

    /// Discover and backup all resources in a namespace.
    ///
    /// If `resource_types` is empty, the types returned by
    /// [`list_resource_types`](Self::list_resource_types) are used.
    pub async fn backup_resources(
        &self,
        namespace: &str,
        resource_types: &[String],
    ) -> Result<K8sResourceManifest> {
        let types: Vec<String> = if resource_types.is_empty() {
            self.list_resource_types(namespace).await?
        } else {
            resource_types.to_vec()
        };
        info!(
            "Backing up K8s resources in namespace: {}, types={}",
            namespace,
            types.len()
        );

        let docs = try_join_all(types.iter().map(|t| {
            let t = t.clone();
            async move {
                let args = ["get", t.as_str(), "-n", namespace, "-o", "json"];
                let out = self.run_kubectl(&args).await?;
                serde_json::from_str::<serde_json::Value>(&out).with_context(|| {
                    format!("failed to parse kubectl output for resource type {}", t)
                })
            }
        }))
        .await?;

        Ok(K8sResourceManifest {
            api_version: "v1".into(),
            kind: "List".into(),
            items: merge_items(docs),
        })
    }

    /// Get a specific resource as raw JSON.
    pub async fn get_resource(&self, kind: &str, name: &str, namespace: &str) -> Result<String> {
        let args = ["get", kind, name, "-n", namespace, "-o", "json"];
        self.run_kubectl(&args).await
    }

    /// List available namespaced resource types.
    pub async fn list_resource_types(&self, _namespace: &str) -> Result<Vec<String>> {
        let out = self.run_kubectl(&["api-resources", "--namespaced", "-o", "name"]).await?;
        Ok(filter_resource_types(&out))
    }

    /// Run `kubectl` (with `--context` when a context is set) and capture output.
    async fn run_kubectl(&self, args: &[&str]) -> Result<String> {
        let mut cmd = tokio::process::Command::new("kubectl");
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
}

/// Concatenate the `items` arrays of the given documents. Documents without an
/// `items` array fall back to the whole document.
pub fn merge_items(docs: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let mut items = Vec::new();
    for doc in docs {
        match doc.get("items").and_then(|v| v.as_array()) {
            Some(arr) => items.extend(arr.iter().cloned()),
            None => items.push(doc),
        }
    }
    items
}

/// Filter the output of `kubectl api-resources -o name` into resource type
/// names, dropping sub-resources (paths containing `/`) and blank lines.
pub fn filter_resource_types(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.contains('/'))
        .map(|l| l.to_string())
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct K8sResourceManifest {
    pub api_version: String,
    pub kind: String,
    pub items: Vec<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_items_concatenates_items_arrays() {
        let docs = vec![
            json!({"apiVersion": "v1", "items": [{"kind": "ConfigMap", "a": 1}, {"a": 2}]}),
            json!({"apiVersion": "v1", "items": [{"a": 3}]}),
        ];
        let merged = merge_items(docs);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0]["kind"], "ConfigMap");
        assert_eq!(merged[2]["a"], 3);
    }

    #[test]
    fn merge_items_falls_back_to_whole_doc() {
        let docs = vec![json!({"kind": "Pod", "metadata": {"name": "web"}}), json!({"items": [{"a": 2}]})];
        let merged = merge_items(docs);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0]["metadata"]["name"], "web");
    }

    #[test]
    fn merge_items_handles_empty_input() {
        assert!(merge_items(Vec::new()).is_empty());
    }

    #[test]
    fn list_resource_types_filtering_drops_subresources_and_blanks() {
        let out = "configmaps\nsecrets\nnamespaces\npods/status\ndeployments\n\nfoo/bar\n";
        let types = filter_resource_types(out);
        assert_eq!(types, vec!["configmaps", "secrets", "namespaces", "deployments"]);
    }

    #[test]
    fn new_reads_context_from_env_when_set() {
        unsafe {
            std::env::set_var("BCK_K8S_CONTEXT", "prod");
        }
        let b = K8sResourceBackup::new();
        assert_eq!(b.context.as_deref(), Some("prod"));
        unsafe {
            std::env::remove_var("BCK_K8S_CONTEXT");
        }
        let b = K8sResourceBackup::new();
        assert!(b.context.is_none());
    }

    #[test]
    fn new_with_context_ignores_empty_string() {
        assert!(K8sResourceBackup::new_with_context("").context.is_none());
        assert_eq!(K8sResourceBackup::new_with_context("dev").context.as_deref(), Some("dev"));
    }
}
