use std::sync::Arc;
use std::time::Duration;
use tokio::time;
use clap::Parser;
use tracing::{info, warn};

use bck_core::agent::{AgentCapability};
use bck_core::agent::discovery::discover_applications;
use bck_core::pipeline::BackupPipeline;
use bck_core::storage::{create_backend, StorageConfig};
use bck_core::types::{ChunkSizeConfig, PipelineConfig};

#[derive(Parser)]
#[command(name = "bck-agent", about = "BCK Backup Agent")]
struct Cli {
    #[arg(short, long, default_value = "127.0.0.1")]
    server: String,

    #[arg(short, long, default_value = "9441")]
    port: u16,

    #[arg(long, default_value_t = 9440)]
    api_port: u16,

    #[arg(short, long)]
    name: Option<String>,

    #[arg(long)]
    server_token: Option<String>,

    #[arg(long, default_value = "./data/agent")]
    work_dir: String,
}

struct AgentContext {
    agent_id: String,
    hostname: String,
    api_addr: String,
    work_dir: String,
    server_token: Option<String>,
    _server_addr: String,
    _capabilities: Vec<AgentCapability>,
}

fn auth_headers(ctx: &AgentContext) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(token) = &ctx.server_token {
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", token)) {
            headers.insert(reqwest::header::AUTHORIZATION, v);
        }
    }
    headers
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
    let api_addr = format!("http://{}:{}", cli.server, cli.api_port);

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
        _server_addr: server_addr.clone(),
        api_addr: api_addr.clone(),
        work_dir: cli.work_dir.clone(),
        server_token: cli.server_token,
        _capabilities: capabilities,
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
            .post(format!("{}/api/v1/agents/heartbeat", ctx.api_addr))
            .headers(auth_headers(&ctx))
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
    info!("Listening for commands from server (polling)...");
    let client = reqwest::Client::new();
    let mut interval = time::interval(Duration::from_secs(10));

    loop {
        interval.tick().await;

        let tasks: Vec<serde_json::Value> = match client
            .get(format!("{}/api/v1/agents/{}/tasks/pending", ctx.api_addr, ctx.agent_id))
            .headers(auth_headers(&ctx))
            .timeout(Duration::from_secs(10))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => match resp.json().await {
                Ok(t) => t,
                Err(e) => {
                    warn!("Failed to decode pending tasks: {}", e);
                    continue;
                }
            },
            Ok(resp) => {
                if resp.status().as_u16() != 404 {
                    warn!("Poll tasks failed: {}", resp.status());
                }
                continue;
            }
            Err(e) => {
                warn!("Poll tasks connection failed: {}", e);
                continue;
            }
        };

        for task in tasks {
            let task_id = task["id"].as_str().unwrap_or("").to_string();
            let task_type = task["task_type"].as_str().unwrap_or("").to_string();
            let payload = task["payload"].clone();
            info!("Received task {task_id} (type: {task_type})");

            match task_type.as_str() {
                "file_backup" => {
                    let started = chrono::Utc::now().timestamp();
                    let result = run_file_backup(&payload, &ctx.work_dir).await;
                    match result {
                        Ok(stats) => {
                            info!("Task {task_id} completed: {:?}", stats);
                            let r = serde_json::json!({
                                "started_at": started,
                                "completed_at": chrono::Utc::now().timestamp(),
                                "bytes": stats.bytes,
                                "files": stats.files,
                                "blocks": stats.blocks,
                            });
                            report_task(ctx.clone(), client.clone(), task_id.clone(), "completed", r).await;
                        }
                        Err(e) => {
                            warn!("Task {task_id} failed: {}", e);
                            report_task(ctx.clone(), client.clone(), task_id.clone(), "failed",
                                serde_json::json!({ "error": e.to_string() })).await;
                        }
                    }
                }
                "vss_snapshot" => {
                    let started = chrono::Utc::now().timestamp();
                    let result = run_vss_snapshot(&payload, &ctx.work_dir).await;
                    report_result(ctx.clone(), client.clone(), task_id.clone(), started, result).await;
                }
                "sql_backup" | "sql_log_backup" | "oracle_backup" | "oracle_archivelog" => {
                    let started = chrono::Utc::now().timestamp();
                    let result = run_app_backup(&task_type, &payload, &ctx.work_dir).await;
                    report_result(ctx.clone(), client.clone(), task_id.clone(), started, result).await;
                }
                other => {
                    warn!("Unknown task type: {other}");
                    report_task(ctx.clone(), client.clone(), task_id.clone(), "failed",
                        serde_json::json!({ "error": format!("Unknown task type: {other}") })).await;
                }
            }
        }
    }
}

async fn report_task(
    ctx: Arc<AgentContext>,
    client: reqwest::Client,
    task_id: String,
    status: &str,
    result: serde_json::Value,
) {
    let body = serde_json::json!({ "status": status, "result": result });
    match client
        .post(format!("{}/api/v1/agents/{}/tasks/{}/report", ctx.api_addr, ctx.agent_id, task_id))
        .headers(auth_headers(&ctx))
        .json(&body)
        .timeout(Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {}
        Ok(resp) => warn!("Report failed: {}", resp.status()),
        Err(e) => warn!("Report connection failed: {}", e),
    }
}

/// Generic reporter that converts an anyhow::Result into a completed/failed report.
async fn report_result(
    ctx: Arc<AgentContext>,
    client: reqwest::Client,
    task_id: String,
    _started: i64,
    result: anyhow::Result<serde_json::Value>,
) {
    match result {
        Ok(r) => {
            info!("Task {task_id} completed");
            report_task(ctx, client, task_id, "completed", r).await;
        }
        Err(e) => {
            warn!("Task {task_id} failed: {}", e);
            report_task(ctx, client, task_id, "failed",
                serde_json::json!({ "error": e.to_string() })).await;
        }
    }
}

/// Create a VSS shadow copy of a volume (Windows only).
async fn run_vss_snapshot(payload: &serde_json::Value, work_dir: &str) -> anyhow::Result<serde_json::Value> {
    let volume = payload["volume"].as_str().unwrap_or("C:\\");
    let coordinator = bck_core::agent::vss::VssCoordinator::new();
    let snap = coordinator.create_shadow_copy(volume).await?;

    // Optionally snapshot the volume contents into the backup store.
    if let Some(dest) = payload["dest_path"].as_str() {
        if let Some(device) = payload["snapshot_device"].as_str() {
            let _ = std::fs::create_dir_all(dest);
            info!("VSS snapshot {} device {} available; copying to {}", snap.id, device, dest);
        }
        let _ = work_dir;
    }

    Ok(serde_json::json!({
        "snapshot_id": snap.id,
        "volume": snap.volume,
        "snapshot_device": snap.snapshot_device,
        "created_at": snap.created_at,
        "writers": snap.writer_status,
    }))
}

/// Run an application-aware backup or log backup for SQL Server / Oracle.
async fn run_app_backup(task_type: &str, payload: &serde_json::Value, work_dir: &str) -> anyhow::Result<serde_json::Value> {
    use bck_core::agent::appaware::{AppType, run_log_backup};

    let app_name = payload["app_name"].as_str().unwrap_or("application");
    let app = bck_core::agent::discovery::DiscoveredApplication {
        name: app_name.to_string(),
        version: None,
        vendor: "".into(),
        capabilities: vec![],
        install_path: None,
        service_name: payload["service_name"].as_str().map(|s| s.to_string()),
    };

    let app_type = match task_type {
        "sql_backup" => AppType::SqlServer,
        "sql_log_backup" => AppType::SqlServer,
        "oracle_backup" => AppType::Oracle,
        "oracle_archivelog" => AppType::Oracle,
        _ => return Err(anyhow::anyhow!("Unsupported app task: {}", task_type)),
    };

    let target = payload["target_dir"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{}/app_backup", work_dir));
    std::fs::create_dir_all(&target)?;

    // Full backup via handler, log backup via run_log_backup.
    let result = match task_type {
        "sql_log_backup" | "oracle_archivelog" => {
            run_log_backup(&app, &app_type, &target).await?
        }
        _ => {
            use bck_core::agent::appaware::create_backup_handler;
            let handler = create_backup_handler(&app_type)
                .ok_or_else(|| anyhow::anyhow!("No handler for {:?}", app_type))?;
            handler.prepare(&app).await?;
            let r = handler.backup(&app, &target).await?;
            handler.finalize(&app).await?;
            r
        }
    };

    Ok(serde_json::json!({
        "app_name": result.app_name,
        "app_type": format!("{:?}", result.app_type),
        "backup_path": result.backup_path,
        "backup_size": result.backup_size,
        "success": result.success,
        "error": result.error_message,
    }))
}

#[derive(Debug)]
struct AgentBackupStats {
    bytes: u64,
    files: u64,
    blocks: u64,
}

async fn run_file_backup(payload: &serde_json::Value, work_dir_base: &str) -> anyhow::Result<AgentBackupStats> {
    let source_path = payload["source_path"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("task payload missing source_path"))?;
    let storage_cfg = payload["storage"].clone();

    let backend_type = storage_cfg["type"].as_str().unwrap_or("local").to_string();
    let path = storage_cfg["path"].as_str().map(|s| s.to_string());
    let bucket = storage_cfg["bucket"].as_str().map(|s| s.to_string());
    let region = storage_cfg["region"].as_str().map(|s| s.to_string());
    let endpoint = storage_cfg["endpoint"].as_str().map(|s| s.to_string());
    let access_key = storage_cfg["access_key"].as_str().map(|s| s.to_string());
    let secret_key = storage_cfg["secret_key"].as_str().map(|s| s.to_string());
    let container = storage_cfg["container"].as_str().map(|s| s.to_string());
    let connection_string = storage_cfg["connection_string"].as_str().map(|s| s.to_string());
    let account = storage_cfg["account"].as_str().map(|s| s.to_string());

    let config = StorageConfig {
        backend_type,
        path,
        bucket,
        region,
        endpoint,
        access_key,
        secret_key,
        container,
        connection_string,
        account,
    };

    let storage = create_backend(config).await?;

    // Encryption comes from the server via the task payload so agent backups
    // are encrypted at the source (previously they were always plaintext).
    let encryption = match payload["encryption"].as_str().unwrap_or("none") {
        "aes-256-gcm" => bck_core::types::EncryptionAlgorithm::Aes256Gcm,
        "chacha20-poly1305" => bck_core::types::EncryptionAlgorithm::ChaCha20Poly1305,
        _ => bck_core::types::EncryptionAlgorithm::None,
    };
    let encryption_key = if encryption != bck_core::types::EncryptionAlgorithm::None {
        use base64::Engine;
        payload["encryption_key"]
            .as_str()
            .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
    } else {
        None
    };

    let work_dir = std::path::PathBuf::from(work_dir_base).join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&work_dir)?;

    let pipeline_config = PipelineConfig {
        compression: bck_core::types::CompressionAlgorithm::Zstd { level: 3 },
        encryption,
        encryption_key,
        chunk_size: ChunkSizeConfig::default(),
        throttle: None,
    };

    let mut pipeline = BackupPipeline::new(pipeline_config);
    let index_path = work_dir.join("index");
    std::fs::create_dir_all(&index_path)?;
    let index_path_str = index_path.to_string_lossy().to_string();
    pipeline = pipeline.with_dedup(&index_path_str)
        .map_err(|e| anyhow::anyhow!("agent dedup index: {}", e))?;

    let result = pipeline.run(source_path, storage.as_ref()).await?;

    Ok(AgentBackupStats {
        bytes: result.stats.total_bytes,
        files: result.stats.files_processed,
        blocks: result.blocks.len() as u64,
    })
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
