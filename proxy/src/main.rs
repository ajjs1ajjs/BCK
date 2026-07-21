use anyhow::Result;
use clap::Parser;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "bck-proxy", about = "BCK Backup Proxy — accelerates VM backup data transfer")]
struct Cli {
    /// Listen address for NFS data path
    #[arg(long, default_value = "0.0.0.0")]
    host: String,

    /// Listen port for NFS data transfer
    #[arg(long, default_value_t = 2049)]
    port: u16,

    /// Transport mode: nfs, san, hotadd
    #[arg(long, default_value = "nfs")]
    transport: String,

    /// BCK server address
    #[arg(long, default_value = "http://127.0.0.1:9440")]
    server: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env()
            .add_directive(tracing::Level::INFO.into()))
        .init();

    let cli = Cli::parse();
    info!("BCK Proxy starting: {}:{}, transport={}, server={}",
        cli.host, cli.port, cli.transport, cli.server);

    match cli.transport.as_str() {
        "nfs" => start_nfs_proxy(&cli).await?,
        "san" => start_san_proxy(&cli).await?,
        _ => warn!("Unsupported transport mode: {}", cli.transport),
    }

    Ok(())
}

async fn start_nfs_proxy(cli: &Cli) -> Result<()> {
    let addr: SocketAddr = format!("{}:{}", cli.host, cli.port).parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!("NFS proxy listening on {}", addr);

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                info!("NFS connection from {}", peer);
                tokio::spawn(async move {
                    if let Err(e) = handle_nfs_connection(stream).await {
                        warn!("NFS connection error from {}: {}", peer, e);
                    }
                });
            }
            Err(e) => warn!("Accept error: {}", e),
        }
    }
}

async fn start_san_proxy(_cli: &Cli) -> Result<()> {
    info!("SAN proxy mode — uses direct storage access");
    // SAN transport: direct LUN access via SCSI commands
    // Bypasses network, reads VM disks directly from SAN storage
    Ok(())
}

async fn handle_nfs_connection(_stream: tokio::net::TcpStream) -> Result<()> {
    // NFS protocol handling:
    // 1. NFSv3/v4 MOUNT protocol
    // 2. READ/WRITE operations to export VM disks
    // 3. Blocks are stored/retrieved from BCK backup storage
    // 4. Implements NFS READ for restore (direct block access)
    // 5. Implements NFS WRITE for backup (stream to pipeline)

    info!("NFS connection handler started");
    Ok(())
}
