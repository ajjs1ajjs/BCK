use anyhow::{Result, anyhow};
use std::io::Write;
use tracing::{info, warn};

use crate::integrations::{HypervisorConnector, PowerState};

/// Failover/Failback execution engine.
///
/// When no hypervisor credentials are configured (BCK_DR_HV_* env vars),
/// `connector` is `None` and the engine degrades to logging + planning so DR
/// still works without external wiring.
pub struct FailoverEngine {
    connector: Option<Box<dyn HypervisorConnector>>,
}

impl FailoverEngine {
    pub fn new() -> Self {
        let connector = build_connector_from_env();
        match &connector {
            Some(_) => info!("FailoverEngine connected to hypervisor from env"),
            None => info!("FailoverEngine running without hypervisor connector (logging only)"),
        }
        Self { connector }
    }

    pub fn new_with(connector: Box<dyn HypervisorConnector>) -> Self {
        Self { connector: Some(connector) }
    }

    /// Whether a real hypervisor connector is available.
    pub fn has_connector(&self) -> bool {
        self.connector.is_some()
    }

    /// Resolve a VM name to a hypervisor reference. The trait `get_vm` takes
    /// a mo_ref, so we first try the name as-is and then, when the VM has an
    /// id distinct from the name, fall back to the id.
    async fn resolve_vm_ref(&self, vm_name: &str) -> Result<String> {
        let connector = self.connector.as_ref()
            .ok_or_else(|| anyhow!("no hypervisor connector configured; cannot resolve VM: {}", vm_name))?;

        match connector.get_vm(vm_name).await {
            Ok(vm) => {
                let resolved = if vm.mo_ref.is_empty() { vm_name.to_string() } else { vm.mo_ref };
                info!("Resolved VM '{}' to ref '{}'", vm_name, resolved);
                Ok(resolved)
            }
            Err(_) => {
                // Fall back: treat the name as the reference directly. The
                // connector may accept ids/names directly (Hyper-V -Id and
                // vCenter accept both).
                info!("VM '{}' not found by name; using it as reference", vm_name);
                Ok(vm_name.to_string())
            }
        }
    }

    /// Power down VMs in the given order.
    pub async fn shutdown_vms(&self, vm_names: &[String], order: &[String]) -> Result<()> {
        let ordered = resolve_vm_order(vm_names, order);
        info!("Shutting down VMs for failover (order: {:?})", ordered);

        let Some(connector) = self.connector.as_ref() else {
            warn!("No hypervisor connector configured; skipping actual shutdown");
            return Ok(());
        };

        let mut failures = Vec::new();
        for vm in &ordered {
            let result = match self.resolve_vm_ref(vm).await {
                Ok(r) => connector.power_off(&r, true).await,
                Err(e) => Err(e),
            };
            match result {
                Ok(()) => info!("VM shut down: {}", vm),
                Err(e) => {
                    warn!("Failed to shut down VM {}: {}", vm, e);
                    failures.push(format!("{}: {}", vm, e));
                }
            }
        }

        if failures.len() == ordered.len() && !ordered.is_empty() {
            return Err(anyhow!(
                "Failed to shut down all VMs: {}",
                failures.join("; ")
            ));
        }
        if !failures.is_empty() {
            warn!("Some VMs failed to shut down: {}", failures.join("; "));
        }
        Ok(())
    }

    /// Power on VMs on target site.
    pub async fn startup_vms(&self, vm_names: &[String]) -> Result<()> {
        info!("Starting VMs on target site ({:?})", vm_names);

        let Some(connector) = self.connector.as_ref() else {
            warn!("No hypervisor connector configured; skipping actual startup");
            return Ok(());
        };

        let mut failures = Vec::new();
        for vm in vm_names {
            let result = match self.resolve_vm_ref(vm).await {
                Ok(r) => connector.power_on(&r).await,
                Err(e) => Err(e),
            };
            match result {
                Ok(()) => info!("VM started: {}", vm),
                Err(e) => {
                    warn!("Failed to start VM {}: {}", vm, e);
                    failures.push(format!("{}: {}", vm, e));
                }
            }
        }

        if failures.len() == vm_names.len() && !vm_names.is_empty() {
            return Err(anyhow!(
                "Failed to start all VMs: {}",
                failures.join("; ")
            ));
        }
        if !failures.is_empty() {
            warn!("Some VMs failed to start: {}", failures.join("; "));
        }
        Ok(())
    }

    /// Wait for VM power-on, polling every 5s until all VMs report
    /// `PoweredOn` or the timeout elapses.
    pub async fn wait_for_heartbeat(&self, vm_names: &[String], timeout_secs: u64) -> Result<()> {
        info!("Waiting for VM heartbeats (timeout={}s, vms={:?})", timeout_secs, vm_names);

        let Some(connector) = self.connector.as_ref() else {
            warn!("No hypervisor connector configured; skipping heartbeat wait");
            return Ok(());
        };

        let deadline = std::time::Instant::now()
            + std::time::Duration::from_secs(timeout_secs);

        loop {
            let mut remaining = Vec::new();
            for vm in vm_names {
                let status = match self.resolve_vm_ref(vm).await {
                    Ok(r) => connector.get_vm(&r).await,
                    Err(e) => Err(e),
                };
                match status {
                    Ok(info_vm) if info_vm.power_state == PowerState::PoweredOn => {}
                    Ok(info_vm) => {
                        remaining.push(format!("{} (state={:?})", vm, info_vm.power_state));
                    }
                    Err(e) => {
                        remaining.push(format!("{} (error={})", vm, e));
                    }
                }
            }

            if remaining.is_empty() {
                info!("All VMs powered on");
                return Ok(());
            }

            if std::time::Instant::now() >= deadline {
                return Err(anyhow!(
                    "Timed out waiting for VMs to power on: {}",
                    remaining.join(", ")
                ));
            }

            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    }

    /// Update DNS records for DR.
    ///
    /// Best-effort: writes a DR hosts-file snippet under the system temp dir
    /// (one "ip hostname" line per VM) and logs each mapping. No real DNS
    /// server integration exists in this crate.
    pub async fn update_dns(&self, vm_to_ip: &[(String, String)]) -> Result<()> {
        if vm_to_ip.is_empty() {
            info!("No DNS records to update");
            return Ok(());
        }

        let path = std::env::temp_dir().join("bck-dr-hosts");
        info!("Writing DR hosts snippet to {}", path.display());

        let mut content = String::from("# BCK DR hosts\n");
        for (vm, ip) in vm_to_ip {
            content.push_str(&format!("{} {}\n", ip, vm));
            info!("DNS mapping: {} -> {}", vm, ip);
        }

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| anyhow!("Failed to open DR hosts file {}: {}", path.display(), e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| anyhow!("Failed to write DR hosts file {}: {}", path.display(), e))?;
        Ok(())
    }
}

/// Order VMs for failover: entries listed in `order` come first (in the given
/// order), then any remaining VMs in their original order.
pub fn resolve_vm_order(vms: &[String], order: &[String]) -> Vec<String> {
    let mut result: Vec<String> = order.iter()
        .filter(|name| vms.contains(name))
        .cloned()
        .collect();
    result.extend(
        vms.iter()
            .filter(|v| !order.contains(v))
            .cloned()
    );
    result
}

fn build_connector_from_env() -> Option<Box<dyn HypervisorConnector>> {
    let hv_type = std::env::var("BCK_DR_HV_TYPE").ok()?;
    let host = std::env::var("BCK_DR_HV_HOST").unwrap_or_default();
    let user = std::env::var("BCK_DR_HV_USER").unwrap_or_default();
    let pass = std::env::var("BCK_DR_HV_PASS").unwrap_or_default();
    let ssl = std::env::var("BCK_DR_HV_SSL")
        .ok()
        .map(|v| !matches!(v.trim().to_lowercase().as_str(), "" | "0" | "false" | "no"))
        .unwrap_or(false);

    match hv_type.trim().to_lowercase().as_str() {
        "hyperv" | "hyper-v" => {
            info!("Building Hyper-V connector from env (host={})", host);
            Some(crate::integrations::hyperv::create_connector(&host, &user, &pass, ssl))
        }
        "vmware" | "vsphere" | "esxi" => {
            let port = std::env::var("BCK_DR_HV_PORT")
                .ok()
                .and_then(|p| p.trim().parse::<u16>().ok())
                .unwrap_or(443);
            info!("Building vSphere connector from env (host={}:{})", host, port);
            Some(crate::integrations::vmware::create_connector(&host, port, &user, &pass, ssl))
        }
        other => {
            warn!("Unknown BCK_DR_HV_TYPE '{}'; no hypervisor connector", other);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_vm_order_puts_ordered_first() {
        let vms = vec!["db".to_string(), "app".to_string(), "web".to_string()];
        let order = vec!["web".to_string(), "db".to_string()];
        assert_eq!(
            resolve_vm_order(&vms, &order),
            vec!["web", "db", "app"]
        );
    }

    #[test]
    fn resolve_vm_order_ignores_unknown_order_entries() {
        let vms = vec!["a".to_string(), "b".to_string()];
        let order = vec!["b".to_string(), "nope".to_string()];
        assert_eq!(resolve_vm_order(&vms, &order), vec!["b", "a"]);
    }

    #[test]
    fn resolve_vm_order_empty_order_preserves_input() {
        let vms = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(resolve_vm_order(&vms, &[]), vms);
    }
}
