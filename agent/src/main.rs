use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time;
use clap::Parser;
use tracing::{info, warn, error};
use tonic::transport::Endpoint;

use bck_core::agent::{AgentCapability, AgentInfo, AgentStatus};
use bck_core::agent::discovery::discover_applications;

#[derive(Parser)]
#[command(name = "bck-agent", about = "BCK Backup Agent")]
struct Cli {
    #[arg(short, long, default_value = "127.0.0.1")]
    server: String,

    #[arg(short, long, default_value = "9441")]
    port: u16,

    #[arg(short, long)]
    name: Option<String>,

    #[arg(long)]
    server_token: Option<String>,
}

struct AgentContext {
    agent_id: String,
    hostname: String,
    server_addr: String,
    capabilities: Vec<AgentCapability>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    let hostname = cli.name.clone()
        .unwrap_or_else(|| hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".into()));

    let agent_id = uuid::Uuid::new_v4().to_string();
    let server_addr = format!("http://{}:{}", cli.server, cli.port);

    info!("Starting BCK Agent: {} (id: {})", hostname, agent_id);
    info!("Server: {}", server_addr);

    // Discover local capabilities
    let apps = discover_applications().await;
    let mut capabilities = vec![AgentCapability::FileSystem, AgentCapability::VolumeSnapshot];

    #[cfg(target_os = "windows")]
    {
        capabilities.push(AgentCapability::Vss);
    }

    for app in &apps {
        for cap in &app.capabilities {
            if !capabilities.contains(cap) {
                capabilities.push(cap.clone());
            }
        }
    }

    info!("Discovered capabilities: {:?}", capabilities);
    for app in &apps {
        info!("  Application: {} ({:?})", app.name, app.version);
    }

    let ctx = Arc::new(AgentContext {
        agent_id: agent_id.clone(),
        hostname: hostname.clone(),
        server_addr: server_addr.clone(),
        capabilities,
    });

    // Connect to server and start heartbeat
    let ctx_clone = ctx.clone();
    let heartbeat_handle = tokio::spawn(async move {
        run_heartbeat(ctx_clone).await;
    });

    // Start backup/restore command listener (gRPC client)
    let ctx_clone2 = ctx.clone();
    let cmd_handle = tokio::spawn(async move {
        listen_for_commands(ctx_clone2).await;
    });

    // Wait for shutdown signal
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("Shutdown signal received");
        }
        _ = heartbeat_handle => {}
        _ = cmd_handle => {}
    }

    info!("Agent stopped");
    Ok(())
}

async fn run_heartbeat(ctx: Arc<AgentContext>) {
    let client = reqwest::Client::new();
    let mut interval = time::interval(Duration::from_secs(30));

    loop {
        interval.tick().await;

        // Collect system metrics
        let cpu = get_cpu_usage();
        let mem = get_memory_usage();
        let disk_free = get_disk_free();

        // Send heartbeat via REST API
        let heartbeat = serde_json::json!({
            "agent_id": ctx.agent_id,
            "hostname": ctx.hostname,
            "cpu_usage": cpu,
            "memory_usage": mem,
            "disk_free_bytes": disk_free,
            "timestamp": chrono::Utc::now().timestamp(),
        });

        match client
            .post(format!("{}/api/v1/agents/heartbeat", "http://127.0.0.1:9440"))
            .json(&heartbeat)
            .timeout(Duration::from_secs(10))
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    tracing::debug!("Heartbeat sent");
                } else {
                    warn!("Heartbeat failed: {}", resp.status());
                }
            }
            Err(e) => {
                warn!("Heartbeat connection failed: {}", e);
            }
        }
    }
}

async fn listen_for_commands(ctx: Arc<AgentContext>) {
    // For now, just wait. Command processing will use gRPC or polling.
    info!("Listening for commands from server...");
    tokio::signal::ctrl_c().await.ok();
}

fn get_cpu_usage() -> f64 {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command",
                r#"(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"#])
            .output()
            .ok();
        if let Some(out) = output {
            if let Ok(s) = String::from_utf8(out.stdout) {
                if let Ok(v) = s.trim().parse::<f64>() {
                    return v;
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let load = std::fs::read_to_string("/proc/loadavg").ok();
        if let Some(l) = load {
            if let Some(first) = l.split_whitespace().next() {
                if let Ok(v) = first.parse::<f64>() {
                    return v * 100.0;
                }
            }
        }
    }
    0.0
}

fn get_memory_usage() -> f64 {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command",
                r#"$os = Get-CimInstance Win32_OperatingSystem; [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize * 100, 2)"#])
            .output()
            .ok();
        if let Some(out) = output {
            if let Ok(s) = String::from_utf8(out.stdout) {
                if let Ok(v) = s.trim().parse::<f64>() {
                    return v;
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let info = std::fs::read_to_string("/proc/meminfo").ok();
        if let Some(i) = info {
            let mut total = 0f64;
            let mut available = 0f64;
            for line in i.lines() {
                if line.starts_with("MemTotal:") {
                    total = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0.0);
                }
                if line.starts_with("MemAvailable:") {
                    available = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0.0);
                }
            }
            if total > 0.0 {
                return (total - available) / total * 100.0;
            }
        }
    }
    0.0
}

fn get_disk_free() -> u64 {
    #[cfg(target_os = "windows")]
    {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let drive_letter = &drive[..1];
        let script = format!("(Get-PSDrive {} | Select-Object -ExpandProperty Free)", drive_letter);
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .ok();
        if let Some(out) = output {
            if let Ok(s) = String::from_utf8(out.stdout) {
                if let Ok(v) = s.trim().replace(',', "").parse::<u64>() {
                    return v;
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("df")
            .args(["--output=avail", "/"])
            .output()
            .ok();
        if let Some(out) = output {
            if let Ok(s) = String::from_utf8(out.stdout) {
                for line in s.lines().skip(1) {
                    if let Ok(bytes) = line.trim().parse::<u64>() {
                        return bytes * 1024;
                    }
                }
            }
        }
    }
    0
}
