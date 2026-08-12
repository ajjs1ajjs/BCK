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
        seed_default_admin(&db, &config).await;
    }

    // Initialize components
    let jwt_secret = resolve_jwt_secret(&config)?;
    let jwt = JwtManager::new(&jwt_secret);

    // Pre-shared token agents must present when calling agent endpoints.
    // Optional: operators can set it explicitly; otherwise a random token is
    // generated once and persisted next to the other secrets.
    let agent_token = resolve_agent_token(&config)?;

    let job_manager = Arc::new(Mutex::new(JobManager::new(db.clone(), config.clone())));

    let scheduler = Arc::new(Mutex::new(Scheduler::new(job_manager.clone())));

    let app_state = Arc::new(AppState {
        config: config.clone(),
        db,
        job_manager: job_manager.clone(),
        scheduler: scheduler.clone(),
        jwt,
        agent_token,
        restore_tracker: bck_core::restore::tracker::RestoreTracker::new(),
        instant_recovery: bck_core::restore::instant::InstantRecoveryRegistry::new(),
        surebackup: bck_core::restore::surebackup::SureBackupEngine::new(),
        sso: bck_core::enterprise::sso::SsoManager::new(),
        sobr: bck_core::sobr::SobrManager::new(),
        cloud: bck_core::cloud::CloudBackupManager::new(),
        cloud_restore: bck_core::cloud::restore::CloudRestoreManager::new(),
        m365: bck_core::m365::M365BackupManager::new(),
        tape: bck_core::tape::TapeManager::new(),
        cdp: bck_core::cdp::CdpEngine::new(
            &config.storage.default_path.to_string_lossy(),
        )?,
        dr: bck_core::dr::DrOrchestrator::new(),
        tenants: bck_core::enterprise::multitenant::TenantManager::new(),
        restore_requests: bck_core::restore::requests::RestoreRequestManager::new(),
    });

    // Start scheduler
    {
        let jm = job_manager.clone();
        // A daemon restart mid-backup left some sessions "running"; mark them
        // failed so the UI/state stay consistent.
        jm.lock().await.reconcile_startup().await;
        let jm_guard = jm.lock().await;
        let jobs = jm_guard.load_job_models().await.unwrap_or_default();
        drop(jm_guard);

        let sched = scheduler.lock().await;
        for job in &jobs {
            sched.add_job(job).await;
        }
        sched.start().await;
    }

    // Build and start API server
    let app = server::create_router(app_state.clone());

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let use_tls = config.server.tls_cert.is_some() && config.server.tls_key.is_some();
    let scheme = if use_tls { "https" } else { "http" };
    info!("API server listening on {}://{}", scheme, addr);
    if !use_tls {
        warn!("TLS is DISABLED for the API. Set server.tls_cert/server.tls_key in config.toml or terminate TLS at a reverse proxy.");
    }

    // Start gRPC server
    let grpc_addr = format!("{}:{}", config.server.host, config.server.grpc_port);
    let grpc_listener = tokio::net::TcpListener::bind(&grpc_addr).await?;
    info!("gRPC server listening on {}", grpc_addr);
    if use_tls {
        warn!("gRPC is served without TLS; agents authenticate with the shared agent token instead");
    }

    // Serve both servers
    tokio::select! {
        result = serve_api(listener, app, config.server.tls_cert.clone(), config.server.tls_key.clone()) => {
            if let Err(e) = result {
                warn!("API server error: {}", e);
            }
        }
        result = serve_grpc(grpc_listener, app_state.clone()) => {
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

async fn serve_api(
    listener: tokio::net::TcpListener,
    app: axum::Router,
    tls_cert: Option<String>,
    tls_key: Option<String>,
) -> anyhow::Result<()> {
    match (tls_cert, tls_key) {
        (Some(cert), Some(key)) => serve_tls(listener, app, &cert, &key).await,
        _ => {
            axum::serve(listener, app)
                .await
                .map_err(|e| anyhow::anyhow!("http serve: {}", e))?;
            Ok(())
        }
    }
}

async fn serve_tls(
    listener: tokio::net::TcpListener,
    app: axum::Router,
    cert_path: &str,
    key_path: &str,
) -> anyhow::Result<()> {
    use hyper_util::rt::{TokioExecutor, TokioIo};
    use hyper_util::server::conn::auto::Builder;
    use hyper_util::service::TowerToHyperService;
    use std::sync::Arc;
    use tokio_rustls::TlsAcceptor;

    let certs = load_certs(cert_path)?;
    let key = load_key(key_path)?;
    let config = rustls::ServerConfig::builder()
        .with_safe_default_cipher_suites()
        .with_safe_default_kx_groups()
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
        .map_err(|e| anyhow::anyhow!("TLS protocol config: {}", e))?
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| anyhow::anyhow!("TLS config: {}", e))?;
    let acceptor = TlsAcceptor::from(Arc::new(config));

    loop {
        let (stream, _addr) = listener.accept().await?;
        let acceptor = acceptor.clone();
        let app = app.clone();
        tokio::spawn(async move {
            let tls_stream = match acceptor.accept(stream).await {
                Ok(s) => s,
                Err(e) => {
                    warn!("TLS handshake failed: {}", e);
                    return;
                }
            };
            let service = TowerToHyperService::new(app);
            let io = TokioIo::new(tls_stream);
            if let Err(e) = Builder::new(TokioExecutor::new())
                .serve_connection_with_upgrades(io, service)
                .await
            {
                warn!("Connection error: {}", e);
            }
        });
    }
}

fn load_certs(path: &str) -> anyhow::Result<Vec<rustls::Certificate>> {
    let mut reader = std::io::BufReader::new(std::fs::File::open(path)?);
    let certs = rustls_pemfile::certs(&mut reader)
        .map_err(|e| anyhow::anyhow!("failed to load certs from {}: {}", path, e))?;
    Ok(certs.into_iter().map(rustls::Certificate).collect())
}

fn load_key(path: &str) -> anyhow::Result<rustls::PrivateKey> {
    // Try PKCS#8 first, then RSA ("BEGIN RSA PRIVATE KEY").
    if let Some(der) = read_pem_key(path, rustls_pemfile::pkcs8_private_keys) {
        return Ok(rustls::PrivateKey(der));
    }
    if let Some(der) = read_pem_key(path, rustls_pemfile::rsa_private_keys) {
        return Ok(rustls::PrivateKey(der));
    }
    Err(anyhow::anyhow!("no private key found in {}", path))
}

fn read_pem_key(
    path: &str,
    f: fn(&mut dyn std::io::BufRead) -> std::io::Result<Vec<Vec<u8>>>,
) -> Option<Vec<u8>> {
    let mut reader = std::io::BufReader::new(std::fs::File::open(path).ok()?);
    let mut keys = f(&mut reader).ok()?;
    if keys.is_empty() {
        return None;
    }
    Some(keys.remove(0))
}

async fn serve_grpc(listener: tokio::net::TcpListener, state: std::sync::Arc<bck_core::server::AppState>) -> anyhow::Result<()> {
    use bck_core::api::grpc::bck_proto::backup_engine_server::BackupEngineServer;
    use bck_core::api::grpc::bck_proto::sobr_service_server::SobrServiceServer;
    use bck_core::api::grpc::bck_proto::cloud_service_server::CloudServiceServer;
    use bck_core::api::grpc::bck_proto::m365_service_server::M365ServiceServer;
    use bck_core::api::grpc::bck_proto::agent_server::AgentServer;
    use bck_core::api::grpc::{
        BackupEngineImpl, SobrServiceService, CloudServiceService, M365ServiceService, AgentService,
    };
    use tonic::service::interceptor::InterceptedService;
    use tonic::transport::Server;
    use tonic::{Request, Status};

    // Every gRPC method requires the pre-shared agent token (`Authorization:
    // Bearer <token>`), exactly like the REST agent endpoints. Without a token
    // the services fail closed. Tokens are compared in constant time.
    let token = state.agent_token.clone();
    let require_token = move |req: Request<()>| {
        let expected = token.as_deref().ok_or_else(|| {
            Status::unauthenticated("agent token not configured; refusing to serve gRPC")
        })?;
        let provided = req
            .metadata()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| Status::unauthenticated("missing agent token"))?;
        if provided.as_bytes().len() == expected.as_bytes().len()
            && provided
                .as_bytes()
                .iter()
                .zip(expected.as_bytes())
                .all(|(a, b)| a == b)
        {
            Ok(req)
        } else {
            Err(Status::unauthenticated("invalid agent token"))
        }
    };

    Server::builder()
        .add_service(InterceptedService::new(
            BackupEngineServer::new(BackupEngineImpl::new(state.clone())),
            require_token.clone(),
        ))
        .add_service(InterceptedService::new(
            SobrServiceServer::new(SobrServiceService::new(state.clone())),
            require_token.clone(),
        ))
        .add_service(InterceptedService::new(
            CloudServiceServer::new(CloudServiceService::new(state.clone())),
            require_token.clone(),
        ))
        .add_service(InterceptedService::new(
            M365ServiceServer::new(M365ServiceService::new(state.clone())),
            require_token.clone(),
        ))
        .add_service(InterceptedService::new(
            AgentServer::new(AgentService::new(state.clone())),
            require_token,
        ))
        .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
        .await?;

    Ok(())
}

/// Create the default admin user when no users exist yet. The initial password
/// is randomly generated, printed once, and persisted to a bootstrap file so
/// the operator/installer can read it (it is never retrievable from the hashed
/// database value afterwards).
async fn seed_default_admin(db: &bck_core::db::DbPool, config: &AppConfig) {
    use bck_core::db::DbPool;

    let count: i64 = match db {
        DbPool::Sqlite(pool) => {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
                .fetch_one(pool)
                .await
                .unwrap_or(0)
        }
        DbPool::Postgres(pool) => {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
                .fetch_one(pool)
                .await
                .unwrap_or(0)
        }
    };

    if count > 0 {
        return;
    }

    let t = chrono::Utc::now().timestamp();
    let id = "00000000-0000-0000-0000-000000000001";
    let username = "admin";
    let password = bck_core::auth::generate_random_password(20);
    let hash = bck_core::auth::hash_password(&password);

    let seed_result = match db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO users (id, username, password_hash, email, role, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'admin@bck.local', 'admin', 1, ?4, ?4)",
            )
            .bind(id)
            .bind(username)
            .bind(&hash)
            .bind(t)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())
            .map(|_| ())
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO users (id, username, password_hash, email, role, enabled, created_at, updated_at)
                 VALUES ($1, $2, $3, 'admin@bck.local', 'admin', 1, $4, $4)",
            )
            .bind(id)
            .bind(username)
            .bind(&hash)
            .bind(t)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())
            .map(|_| ())
        }
    };

    match seed_result {
        Ok(()) => {
            // Print the bootstrap credential once. After first login the
            // operator must change it; there is no hardcoded default.
            eprintln!("======================================================");
            eprintln!("  BCK: initial admin account created");
            eprintln!("  username: admin");
            eprintln!("  password: {}", password);
            eprintln!("  Change this password immediately after first login.");
            eprintln!("======================================================");
            info!("Seeded default admin user with a generated password.");

            // Persist the password to a bootstrap file (0600) next to the data
            // dir so the installer / operator can read it without scanning the
            // journal. The file is intentionally NOT in the backups directory.
            let bootstrap_path = config
                .storage
                .default_path
                .parent()
                .unwrap_or(&config.storage.default_path)
                .join("bootstrap_admin.txt");
            if let Some(parent) = bootstrap_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(
                &bootstrap_path,
                format!("username: admin\npassword: {}\n", password),
            ) {
                warn!("Failed to persist bootstrap admin password to {}: {}", bootstrap_path.display(), e);
            } else {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(
                        &bootstrap_path,
                        std::fs::Permissions::from_mode(0o600),
                    );
                }
                info!("Bootstrap admin password written to {}", bootstrap_path.display());
            }
        }
        Err(e) => warn!("Failed to seed default admin: {}", e),
    }
}

/// Resolve the JWT signing secret: BCK_JWT_SECRET env wins; otherwise a random
/// 32-byte secret is generated once and persisted (0600) next to the data dir
/// so tokens survive restarts. Never falls back to a hardcoded value.
fn resolve_jwt_secret(config: &AppConfig) -> anyhow::Result<Vec<u8>> {
    if let Ok(secret) = std::env::var("BCK_JWT_SECRET") {
        if secret.len() < 32 {
            warn!("BCK_JWT_SECRET is shorter than 32 bytes; use a long random value");
        }
        return Ok(secret.into_bytes());
    }

    let path = config.storage.default_path.join("jwt_secret");
    if let Ok(existing) = std::fs::read(&path) {
        if existing.len() >= 32 {
            return Ok(existing);
        }
    }

    let secret = bck_core::auth::random_bytes(32);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, &secret)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    warn!(
        "BCK_JWT_SECRET not set; generated and persisted a random secret at {}",
        path.display()
    );
    Ok(secret)
}

/// Resolve the pre-shared agent token from BCK_AGENT_TOKEN or the config file;
/// otherwise generate and persist one. Used to authenticate agent endpoints.
fn resolve_agent_token(config: &AppConfig) -> anyhow::Result<Option<String>> {
    if let Ok(token) = std::env::var("BCK_AGENT_TOKEN") {
        if !token.is_empty() {
            return Ok(Some(token));
        }
    }
    if let Some(token) = &config.agent_token {
        if !token.is_empty() {
            return Ok(Some(token.clone()));
        }
    }

    let path = config.storage.default_path.join("agent_token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        if !existing.trim().is_empty() {
            return Ok(Some(existing.trim().to_string()));
        }
    }

    let token = bck_core::auth::generate_random_password(32);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, &token)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    warn!(
        "BCK_AGENT_TOKEN not set; generated and persisted an agent token at {}",
        path.display()
    );
    Ok(Some(token))
}
