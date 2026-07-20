use clap::{Parser, Subcommand};
use serde_json::json;

#[derive(Parser)]
#[command(name = "bck", about = "BCK Enterprise Backup CLI")]
struct Cli {
    #[arg(short, long, default_value = "http://127.0.0.1:9440")]
    server: String,

    #[arg(short, long)]
    token: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a backup job
    JobCreate {
        name: String,
        source: String,
        repo: String,
    },
    /// List backup jobs
    JobList,
    /// Run a backup job
    JobRun { id: String },
    /// Cancel a running job
    JobCancel { id: String },
    /// Show job status
    JobStatus { id: String },

    /// List repositories
    RepoList,
    /// Add a repository
    RepoAdd { name: String, repo_type: String, path: String },

    /// List snapshots
    SnapshotList { job_id: String },
    /// Delete a snapshot
    SnapshotDelete { id: String },

    /// Restore from snapshot
    Restore {
        snapshot_id: String,
        target: String,
    },

    /// Show system status
    Status,

    /// Show server logs
    Logs {
        #[arg(short, long)]
        tail: bool,
        #[arg(short, long)]
        job: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let client = reqwest::Client::new();

    match cli.command {
        Commands::JobCreate { name, source, repo } => {
            let resp = client
                .post(format!("{}/api/v1/jobs", cli.server))
                .json(&json!({
                    "name": name,
                    "source_path": source,
                    "repository_id": repo,
                    "job_type": "file",
                    "backup_type": "incremental",
                }))
                .send()
                .await?;
            println!("{}", resp.text().await?);
        }
        Commands::JobList => {
            let resp = client
                .get(format!("{}/api/v1/jobs", cli.server))
                .send()
                .await?;
            println!("{}", serde_json::to_string_pretty(&resp.json::<serde_json::Value>().await?)?);
        }
        Commands::JobRun { id } => {
            let resp = client
                .post(format!("{}/api/v1/jobs/{}/run", cli.server, id))
                .send()
                .await?;
            println!("{}", resp.text().await?);
        }
        Commands::JobCancel { id } => {
            let resp = client
                .post(format!("{}/api/v1/jobs/{}/cancel", cli.server, id))
                .send()
                .await?;
            println!("{}", resp.text().await?);
        }
        Commands::JobStatus { id } => {
            let resp = client
                .get(format!("{}/api/v1/jobs/{}", cli.server, id))
                .send()
                .await?;
            println!("{}", serde_json::to_string_pretty(&resp.json::<serde_json::Value>().await?)?);
        }
        Commands::RepoList => {
            println!("[]");
        }
        Commands::RepoAdd { name, repo_type, path } => {
            println!("Added repository: {} ({} at {})", name, repo_type, path);
        }
        Commands::SnapshotList { job_id } => {
            println!("Snapshots for job {}: []", job_id);
        }
        Commands::SnapshotDelete { id } => {
            println!("Deleted snapshot: {}", id);
        }
        Commands::Restore { snapshot_id, target } => {
            println!("Restoring {} to {}...", snapshot_id, target);
        }
        Commands::Status => {
            let resp = client
                .get(format!("{}/api/v1/dashboard/stats", cli.server))
                .send()
                .await?;
            println!("{}", serde_json::to_string_pretty(&resp.json::<serde_json::Value>().await?)?);
        }
        Commands::Logs { tail, job } => {
            if tail { print!("--tail "); }
            if let Some(j) = job { print!("--job {} ", j); }
            println!("logs (not implemented)");
        }
    }

    Ok(())
}
