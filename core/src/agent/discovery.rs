use serde::{Deserialize, Serialize};
use tracing::info;

use super::AgentCapability;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredApplication {
    pub name: String,
    pub version: Option<String>,
    pub vendor: String,
    pub capabilities: Vec<AgentCapability>,
    pub install_path: Option<String>,
    pub service_name: Option<String>,
}

/// Detect installed applications on the system
pub async fn discover_applications() -> Vec<DiscoveredApplication> {
    let mut apps = Vec::new();

    #[cfg(target_os = "windows")]
    {
        discover_windows_apps(&mut apps).await;
    }

    #[cfg(target_os = "linux")]
    {
        discover_linux_apps(&mut apps).await;
    }

    info!("Discovered {} applications", apps.len());
    apps
}

#[cfg(target_os = "windows")]
async fn discover_windows_apps(apps: &mut Vec<DiscoveredApplication>) {
    // Check for SQL Server
    if let Some(version) = check_sql_server().await {
        apps.push(DiscoveredApplication {
            name: "Microsoft SQL Server".into(),
            version: Some(version),
            vendor: "Microsoft".into(),
            capabilities: vec![AgentCapability::AppAwareSql],
            install_path: None,
            service_name: Some("MSSQLSERVER".into()),
        });
    }

    // Check for Exchange
    if let Ok(_) = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-Service -Name MSExchange* -ErrorAction SilentlyContinue"])
        .output()
    {
        apps.push(DiscoveredApplication {
            name: "Microsoft Exchange".into(),
            version: None,
            vendor: "Microsoft".into(),
            capabilities: vec![AgentCapability::AppAwareExchange],
            install_path: None,
            service_name: Some("MSExchangeIS".into()),
        });
    }

    // Check for Active Directory
    if std::env::var("USERDOMAIN").is_ok() && std::env::var("LOGONSERVER").is_ok() {
        if let Ok(output) = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command",
                "Get-Service -Name NTDS -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status"])
            .output()
        {
            let status = String::from_utf8_lossy(&output.stdout);
            if status.trim() == "Running" {
                apps.push(DiscoveredApplication {
                    name: "Active Directory".into(),
                    version: None,
                    vendor: "Microsoft".into(),
                    capabilities: vec![AgentCapability::AppAwareActiveDirectory],
                    install_path: None,
                    service_name: Some("NTDS".into()),
                });
            }
        }
    }

    // Check for PostgreSQL
    if let Ok(output) = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command",
            "Get-Service -Name postgresql* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name"])
        .output()
    {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !name.is_empty() {
            let version = check_postgres_version().await;
            apps.push(DiscoveredApplication {
                name: "PostgreSQL".into(),
                version,
                vendor: "PostgreSQL Global Development Group".into(),
                capabilities: vec![AgentCapability::AppAwarePostgres],
                install_path: None,
                service_name: Some(name),
            });
        }
    }
}

#[cfg(target_os = "windows")]
async fn check_sql_server() -> Option<String> {
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command",
            r#"(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL' 2>$null).PSObject.Properties | Select-Object -First 1 | ForEach-Object { $_.Value }"#])
        .output()
        .ok()?;

    let instance = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if instance.is_empty() { return None; }

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command",
            &format!(r#"(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\{}\Setup' -ErrorAction SilentlyContinue).Version"#, instance)])
        .output()
        .ok()?;

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() { None } else { Some(version) }
}

#[cfg(target_os = "windows")]
async fn check_postgres_version() -> Option<String> {
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command",
            r#"Get-ItemProperty 'HKLM:\SOFTWARE\PostgreSQL\*' -ErrorAction SilentlyContinue | Select-Object @{N='Version';E={$_.Version}} | ConvertTo-Json -Compress"#])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() { return None; }

    // Simple parse
    if let Some(pos) = stdout.find("Version") {
        let val = &stdout[pos..];
        if let Some(start) = val.find('"') {
            if let Some(end) = val[start+1..].find('"') {
                return Some(val[start+1..start+1+end].to_string());
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
async fn discover_linux_apps(apps: &mut Vec<DiscoveredApplication>) {
    // Check for PostgreSQL
    if let Ok(output) = tokio::process::Command::new("pg_config")
        .arg("--version")
        .output()
        .await
    {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            apps.push(DiscoveredApplication {
                name: "PostgreSQL".into(),
                version: Some(version),
                vendor: "PostgreSQL Global Development Group".into(),
                capabilities: vec![AgentCapability::AppAwarePostgres],
                install_path: None,
                service_name: Some("postgresql".into()),
            });
        }
    }

    // Check for Oracle via sqlplus
    if let Ok(output) = tokio::process::Command::new("sqlplus")
        .arg("-V")
        .output()
        .await
    {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout);
            let version = version.lines().next().map(|l| l.to_string());
            apps.push(DiscoveredApplication {
                name: "Oracle Database".into(),
                version,
                vendor: "Oracle".into(),
                capabilities: vec![AgentCapability::AppAwareOracle],
                install_path: std::env::var("ORACLE_HOME").ok(),
                service_name: Some("oracle".into()),
            });
        }
    }

    // Check for MySQL/MariaDB
    if let Ok(output) = tokio::process::Command::new("mysql")
        .arg("--version")
        .output()
        .await
    {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            apps.push(DiscoveredApplication {
                name: "MySQL".into(),
                version: Some(version),
                vendor: "Oracle".into(),
                capabilities: vec![],  // No specific handler yet
                install_path: None,
                service_name: Some("mysql".into()),
            });
        }
    }
}
