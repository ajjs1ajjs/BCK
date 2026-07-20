use clap::Parser;
use tracing::info;

#[derive(Parser)]
#[command(name = "bck-proxy", about = "BCK Backup Proxy")]
struct Cli {
    #[arg(short, long, default_value = "0.0.0.0")]
    host: String,

    #[arg(short, long, default_value = "9442")]
    port: u16,

    #[arg(long)]
    transport: Option<String>, // san, nfs, hotadd

    #[arg(short, long, default_value = "127.0.0.1:9441")]
    server: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();
    info!("Starting BCK Proxy on {}:{}", cli.host, cli.port);
    info!("Backend server: {}", cli.server);

    // TODO: implement proxy logic

    tokio::signal::ctrl_c().await?;
    info!("Proxy stopped");

    Ok(())
}
