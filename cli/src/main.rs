use anyhow::{Result, anyhow};
use clap::{Parser, Subcommand};
use serde_json::{json, Value};

#[derive(Parser)]
#[command(name = "bck", about = "BCK Enterprise Backup CLI")]
struct Cli {
    #[arg(short, long, default_value = "http://127.0.0.1:9440")]
    server: String,

    #[arg(short, long)]
    token: Option<String>,

    #[arg(long, default_value = "admin")]
    username: String,

    #[arg(long, default_value = "admin")]
    password: String,

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
        #[arg(long)]
        schedule: Option<String>,
        #[arg(long, default_value = "full")]
        backup_type: String,
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

    /// Restore files from a snapshot
    Restore {
        snapshot_id: String,
        target: String,
        #[arg(short, long)]
        files: Option<String>,
        #[arg(long)]
        overwrite: bool,
    },

    /// Show system status
    Status,

    /// Show server logs / events
    Logs {
        #[arg(short, long)]
        tail: bool,
        #[arg(short, long)]
        limit: Option<i64>,
        #[arg(short, long)]
        job: Option<String>,
    },
}

struct Api {
    server: String,
    token: String,
    client: reqwest::Client,
}

impl Api {
    fn new(server: &str, token: String) -> Self {
        Self {
            server: server.trim_end_matches('/').to_string(),
            token,
            client: reqwest::Client::new(),
        }
    }

    async fn auth_headers(&self) -> String {
        format!("Bearer {}", self.token)
    }

    async fn get(&self, path: &str) -> Result<Value> {
        let resp = self.client
            .get(format!("{}{}", self.server, path))
            .header("Authorization", self.auth_headers().await)
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("{} {}: {}", status, path, body));
        }
        if body.trim().is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_str(&body).map_err(|e| anyhow!("invalid JSON from {}: {}", path, e))
        }
    }

    async fn send(&self, method: &str, path: &str, payload: Option<Value>) -> Result<Value> {
        let mut req = self.client.request(
            reqwest::Method::from_bytes(method.as_bytes())?,
            format!("{}{}", self.server, path),
        );
        if let Some(body) = payload {
            req = req.json(&body);
        }
        let resp = req
            .header("Authorization", self.auth_headers().await)
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("{} {}: {}", status, path, body));
        }
        if body.trim().is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_str(&body).map_err(|e| anyhow!("invalid JSON from {}: {}", path, e))
        }
    }
}

async fn login(server: &str, username: &str, password: &str) -> Result<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/v1/auth/login", server.trim_end_matches('/')))
        .json(&json!({ "username": username, "password": password }))
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        return Err(anyhow!("login failed ({}): {}", status, body));
    }
    body["token"].as_str()
        .map(|t| t.to_string())
        .ok_or_else(|| anyhow!("login response missing token"))
}

fn print_json(v: &Value) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_else(|_| "{}".into()));
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let token = match cli.token.clone() {
        Some(t) => t,
        None => login(&cli.server, &cli.username, &cli.password).await?,
    };
    let api = Api::new(&cli.server, token);

    match cli.command {
        Commands::JobCreate { name, source, repo, schedule, backup_type } => {
            let resp = api.send("POST", "/api/v1/jobs", Some(json!({
                "name": name,
                "source_path": source,
                "repository_id": repo,
                "job_type": "file",
                "backup_type": backup_type,
                "schedule": schedule,
            }))).await?;
            print_json(&resp);
        }
        Commands::JobList => {
            let resp = api.get("/api/v1/jobs").await?;
            print_json(&resp);
        }
        Commands::JobRun { id } => {
            let resp = api.send("POST", &format!("/api/v1/jobs/{}/run", id), None).await?;
            print_json(&resp);
        }
        Commands::JobCancel { id } => {
            let resp = api.send("POST", &format!("/api/v1/jobs/{}/cancel", id), None).await?;
            print_json(&resp);
        }
        Commands::JobStatus { id } => {
            let resp = api.get(&format!("/api/v1/jobs/{}", id)).await?;
            print_json(&resp);
        }
        Commands::RepoList => {
            let resp = api.get("/api/v1/repositories").await?;
            print_json(&resp);
        }
        Commands::RepoAdd { name, repo_type, path } => {
            let resp = api.send("POST", "/api/v1/repositories", Some(json!({
                "name": name,
                "repo_type": repo_type,
                "path": path,
            }))).await?;
            print_json(&resp);
        }
        Commands::SnapshotList { job_id } => {
            let resp = api.get(&format!("/api/v1/snapshots?job_id={}", job_id)).await?;
            print_json(&resp);
        }
        Commands::SnapshotDelete { id } => {
            api.send("DELETE", &format!("/api/v1/snapshots/{}", id), None).await?;
            println!("Deleted snapshot: {}", id);
        }
        Commands::Restore { snapshot_id, target, files, overwrite } => {
            let file_list = files
                .map(|f| f.split(',').map(|s| s.trim().to_string()).collect::<Vec<_>>())
                .unwrap_or_default();
            let resp = api.send("POST", "/api/v1/restore/file", Some(json!({
                "snapshot_id": snapshot_id,
                "files": file_list,
                "target_path": target,
                "overwrite": overwrite,
            }))).await?;
            print_json(&resp);
        }
        Commands::Status => {
            let resp = api.get("/api/v1/dashboard/stats").await?;
            print_json(&resp);
        }
        Commands::Logs { tail, limit, job } => {
            let mut path = format!("/api/v1/events?limit={}", limit.unwrap_or(50));
            if tail {
                path.push_str("&tail=true");
            }
            let resp = api.get(&path).await?;
            let events = resp.as_array().cloned().unwrap_or_default();
            for ev in events {
                let job_match = match &job {
                    Some(j) => ev["job_id"].as_str() == Some(j.as_str()),
                    None => true,
                };
                if !job_match {
                    continue;
                }
                println!(
                    "[{}] {} ({}): {}",
                    ev["created_at"].as_i64().unwrap_or(0),
                    ev["event_type"].as_str().unwrap_or("event"),
                    ev["source"].as_str().unwrap_or("-"),
                    ev["message"].as_str().unwrap_or(""),
                );
            }
        }
    }

    Ok(())
}
