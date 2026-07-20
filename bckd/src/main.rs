use std::sync::Arc;
use tokio::sync::Mutex;

use clap::Parser;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use bck_core::config::AppConfig;
use bck_core::db::DbPool;
use bck_core::auth::jwt::JwtManager;
use bck_core::job::JobManager;
use bck_core::scheduler::Scheduler;
use bck_core::server::{self, AppState};

#[derive(Parser)]
#[command(name = "bckd", about = "BCK Enterprise Backup Daemon")]
struct Cli {
    #[arg(short, long, default_value = "config.toml")]
    config: String,

    #[arg(short, long)]
    port: Option<u16>,

    #[arg(short, long)]
    database_url: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Load config
    let mut config = if std::path::Path::new(&cli.config).exists() {
        AppConfig::load(&cli.config)?
    } else {
        info!("Config file not found, using defaults");
        let config = AppConfig::default();
        config.save(&cli.config)?;
        info!("Created default config at {}", cli.config);
        config
    };

    // Override from CLI args
    if let Some(port) = cli.port {
        config.server.port = port;
    }
    if let Some(url) = cli.database_url {
        config.database.url = url;
    }

    // Init logging
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&config.logging.level));
    if config.logging.json {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .json()
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .init();
    }

    info!("Starting BCK Enterprise Backup Daemon");
    info!("Version: {}", env!("CARGO_PKG_VERSION"));

    // Ensure directories exist
    std::fs::create_dir_all(&config.storage.default_path)?;
    std::fs::create_dir_all(&config.storage.temp_path)?;

    // Connect to database
    info!("Connecting to database...");
    let db = DbPool::connect(&config.database.url, config.database.pool_size).await?;

    if config.database.migrate {
        info!("Running database migrations...");
        db.migrate().await?;
    }

    // Initialize components
    let jwt_secret = std::env::var("BCK_JWT_SECRET")
        .unwrap_or_else(|_| "bck-dev-secret-change-in-production".to_string());
    let jwt = JwtManager::new(jwt_secret.as_bytes());

    let job_manager = Arc::new(Mutex::new(JobManager::new()));

    let scheduler = Arc::new(Mutex::new(Scheduler::new(job_manager.clone())));

    let app_state = Arc::new(AppState {
        config: config.clone(),
        db,
        job_manager,
        scheduler: scheduler.clone(),
        jwt,
    });

    // Start scheduler
    {
        let sched = scheduler.lock().await;
        sched.start().await;
    }

    // Build and start API server
    let app = server::create_router(app_state.clone());

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("API server listening on http://{}", addr);

    // Start gRPC server
    let grpc_addr = format!("{}:{}", config.server.host, config.server.grpc_port);
    let grpc_listener = tokio::net::TcpListener::bind(&grpc_addr).await?;
    info!("gRPC server listening on {}", grpc_addr);

    // Serve both servers
    tokio::select! {
        result = axum::serve(listener, app) => {
            if let Err(e) = result {
                warn!("API server error: {}", e);
            }
        }
        result = serve_grpc(grpc_listener) => {
            if let Err(e) = result {
                warn!("gRPC server error: {}", e);
            }
        }
    }

    // Graceful shutdown
    {
        let sched = scheduler.lock().await;
        sched.stop().await;
    }

    info!("BCK daemon stopped");
    Ok(())
}

async fn serve_grpc(listener: tokio::net::TcpListener) -> anyhow::Result<()> {
    use bck_core::api::grpc::bck_proto::backup_engine_server::BackupEngineServer;
    use bck_core::api::grpc::BackupEngineImpl;
    use tonic::transport::Server;

    let engine = BackupEngineImpl::new();

    Server::builder()
        .add_service(BackupEngineServer::new(engine))
        .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
        .await?;

    Ok(())
}
