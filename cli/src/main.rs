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

    // No default password: it must be supplied (or use --token). The daemon no
    // longer provisions an admin/admin account; the initial password is random.
    #[arg(long)]
    password: Option<String>,

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

    /// SOBR management (scale-out backup repository)
    #[command(subcommand)]
    Sobr(SobrCmd),
    /// Cloud account management (AWS / Azure / GCP)
    #[command(subcommand)]
    Cloud(CloudCmd),
    /// Microsoft 365 backup management
    #[command(subcommand)]
    M365(M365Cmd),
    /// Disaster recovery management
    #[command(subcommand)]
    Dr(DrCmd),
    /// Multi-tenancy management
    #[command(subcommand)]
    Tenant(TenantCmd),
    /// Self-service restore portal
    #[command(subcommand)]
    Portal(PortalCmd),
    /// Hypervisor and VM backup management
    #[command(subcommand)]
    Hypervisor(HypervisorCmd),
}

#[derive(Subcommand)]
enum SobrCmd {
    /// List SOBR storage tiers
    Tiers,
    /// Register a storage tier
    TierAdd {
        name: String,
        #[arg(long, default_value = "Capacity")]
        tier_type: String,
        #[arg(long, default_value = "local")]
        backend: String,
        #[arg(long, default_value = "1000000000000")]
        capacity: u64,
        #[arg(long, default_value = "10")]
        priority: u32,
    },
    /// List SOBR lifecycle policies
    Policies,
    /// Create a lifecycle policy
    PolicyAdd {
        name: String,
        #[arg(long)]
        performance_tier_id: String,
        #[arg(long)]
        capacity_tier_id: String,
        #[arg(long)]
        archive_tier_id: Option<String>,
        #[arg(long, default_value = "7")]
        capacity_move_days: u32,
        #[arg(long)]
        archive_move_days: Option<u32>,
        #[arg(long)]
        seal_days: Option<u32>,
        #[arg(long)]
        retention_days: Option<u32>,
    },
    /// Run data movement for a policy
    Execute { id: String },
}

#[derive(Subcommand)]
enum CloudCmd {
    /// List cloud accounts
    List,
    /// Register a cloud account
    Register {
        name: String,
        #[arg(long, default_value = "Aws")]
        provider: String,
        #[arg(long, default_value = "access_key")]
        auth_type: String,
        #[arg(long, default_value = "us-east-1")]
        region: String,
        #[arg(long)]
        access_key: Option<String>,
        #[arg(long)]
        secret_key: Option<String>,
        #[arg(long)]
        tenant_id: Option<String>,
        #[arg(long)]
        client_id: Option<String>,
        #[arg(long)]
        client_secret: Option<String>,
        #[arg(long)]
        project_id: Option<String>,
    },
    /// Remove a cloud account
    Remove { id: String },
    /// List restorable resource kinds for an account
    Restorable { id: String },
    /// List cloud restore operations (optionally scoped to an account)
    Restores {
        #[arg(long)]
        account: Option<String>,
    },
    /// Submit a cloud restore operation
    Restore {
        #[arg(long)]
        account: String,
        #[arg(long)]
        resource_type: String,
        #[arg(long)]
        resource_id: String,
        #[arg(long)]
        target_name: String,
        #[arg(long)]
        subscription_id: Option<String>,
        #[arg(long)]
        resource_group: Option<String>,
        #[arg(long)]
        zone: Option<String>,
    },
}

#[derive(Subcommand)]
enum M365Cmd {
    /// List M365 tenants
    Tenants,
    /// Register an M365 tenant
    TenantAdd {
        name: String,
        #[arg(long)]
        tenant_id: String,
        #[arg(long)]
        client_id: String,
        #[arg(long)]
        client_secret: String,
        #[arg(long, default_value = "AppOnly")]
        auth_type: String,
    },
    /// List M365 backup jobs
    Jobs,
    /// Start an M365 backup
    Backup {
        tenant_id: String,
        #[arg(long, default_value = "All")]
        backup_type: String,
    },
}

#[derive(Subcommand)]
enum DrCmd {
    /// Show DR status
    Status,
    /// List DR sites
    Sites,
    /// Register a DR site
    SiteAdd {
        name: String,
        #[arg(long, default_value = "RemoteBck")]
        dr_type: String,
        #[arg(long)]
        endpoint: String,
        #[arg(long)]
        storage_id: String,
        #[arg(long)]
        credentials_id: String,
    },
    /// List recovery plans
    Plans,
    /// Create a recovery plan
    PlanAdd {
        name: String,
        #[arg(long)]
        source_site: String,
        #[arg(long)]
        target_site: String,
        #[arg(long)]
        vms: String,
        #[arg(long, default_value = "900")]
        rpo_seconds: u64,
        #[arg(long, default_value = "3600")]
        rto_seconds: u64,
    },
    /// Execute failover for a plan
    Failover { id: String },
    /// Execute failback for a plan
    Failback { id: String },
    /// Test failover (non-destructive)
    Test { id: String },
}

#[derive(Subcommand)]
enum TenantCmd {
    /// List all tenants
    List,
    /// Create a tenant
    Add {
        name: String,
        slug: String,
    },
    /// Show a tenant by ID
    Get { id: String },
    /// Delete a tenant
    Delete { id: String },
    /// Suspend a tenant
    Suspend { id: String },
    /// Activate a tenant
    Activate { id: String },
    /// Disable a tenant
    Disable { id: String },
    /// Update a tenant's resource quota
    Quota {
        id: String,
        #[arg(long, default_value = "5")]
        max_repositories: u32,
        #[arg(long, default_value = "50")]
        max_vms: u32,
        #[arg(long, default_value = "10")]
        max_users: u32,
        #[arg(long, default_value = "1024")]
        max_storage_gb: u64,
        #[arg(long, default_value = "90")]
        max_retention_days: u32,
        #[arg(long, default_value = "30")]
        max_snapshots_per_vm: u32,
        #[arg(long)]
        allow_cloud_tiers: bool,
        #[arg(long)]
        allow_tape: bool,
    },
    /// Update a tenant's settings
    Settings {
        id: String,
        #[arg(long, default_value = "30")]
        default_retention_days: u32,
        #[arg(long, default_value = "22:00")]
        backup_window_start: String,
        #[arg(long, default_value = "06:00")]
        backup_window_end: String,
        #[arg(long)]
        notify_on_failure: bool,
        #[arg(long)]
        notify_on_success: bool,
        #[arg(long, default_value = "vmware, hyperv")]
        allowed_hypervisors: String,
        #[arg(long, default_value = "local, s3")]
        allowed_storage: String,
    },
}

#[derive(Subcommand)]
enum HypervisorCmd {
    /// List registered hypervisors
    List,
    /// Discover VMs on a hypervisor
    Vms { id: String },
    /// Start a full backup of a VM on a hypervisor
    Backup {
        /// Hypervisor id
        id: String,
        /// VM reference on the hypervisor
        #[arg(long)]
        vm_ref: String,
        /// Target repository id
        #[arg(long)]
        repo: String,
        /// Job name
        #[arg(long)]
        name: Option<String>,
        /// Schedule (cron)
        #[arg(long)]
        schedule: Option<String>,
        /// Retention days
        #[arg(long)]
        retention_days: Option<i32>,
    },
    /// Show status of a backup job
    JobStatus { id: String },
    /// Instant-recover a VM on a hypervisor (boot from backup via NFS/iSCSI)
    InstantRecover {
        /// Hypervisor id
        id: String,
        /// Snapshot id to boot from
        #[arg(long)]
        snapshot: String,
        /// VM name for the recovered machine
        #[arg(long)]
        vm_name: String,
        /// Protocol: nfs (default) or iscsi
        #[arg(long, default_value = "nfs")]
        protocol: String,
        /// Listen address for the export server (host:port)
        #[arg(long, default_value = "")]
        target_host: String,
        /// Datastore name on the hypervisor
        #[arg(long, default_value = "")]
        datastore: String,
        /// Power the recovered VM on
        #[arg(long)]
        power_on: bool,
    },
    /// List active instant recovery sessions
    InstantList,
    /// Stop an instant recovery session
    InstantStop { id: String },
}

#[derive(Subcommand)]
enum PortalCmd {
    /// Show the current user's portal profile
    Me,
    /// List the current user's restore requests
    MyRequests,
    /// Submit a restore request for approval
    Submit {
        snapshot_id: String,
        #[arg(long)]
        target_path: String,
        #[arg(long)]
        files: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Cancel a pending restore request
    Cancel { id: String },
    /// List all restore requests (admin / operator)
    Requests,
    /// Approve a pending restore request
    Approve {
        id: String,
        #[arg(long)]
        note: Option<String>,
    },
    /// Reject a pending restore request
    Reject {
        id: String,
        #[arg(long)]
        note: Option<String>,
    },
    /// Mark an approved request as completed
    Complete { id: String },
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

    // Credentials must not travel over plaintext HTTP to a remote host.
    let is_loopback = cli.server.contains("127.0.0.1") || cli.server.contains("localhost");
    if !cli.server.starts_with("https://") && !is_loopback {
        eprintln!(
            "WARNING: {server} is not HTTPS and not loopback; credentials would be sent in plaintext.",
            server = cli.server
        );
        return Err(anyhow!(
            "Refusing to send credentials over plaintext HTTP. Use https://{host} or terminate TLS at a reverse proxy.",
            host = cli.server.trim_start_matches("http://")
        ));
    }

    let token = match cli.token.clone() {
        Some(t) => t,
        None => {
            let password = cli.password
                .ok_or_else(|| anyhow!("either --token or --password is required"))?;
            login(&cli.server, &cli.username, &password).await?
        }
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
        Commands::Sobr(cmd) => match cmd {
            SobrCmd::Tiers => {
                let resp = api.get("/api/v1/sobr").await?;
                print_json(&resp);
            }
            SobrCmd::TierAdd { name, tier_type, backend, capacity, priority } => {
                let resp = api.send("POST", "/api/v1/sobr/tiers", Some(json!({
                    "name": name,
                    "tier_type": tier_type,
                    "backend": backend,
                    "backend_config": {},
                    "capacity_bytes": capacity,
                    "used_bytes": 0,
                    "status": "Online",
                    "priority": priority,
                }))).await?;
                print_json(&resp);
            }
            SobrCmd::Policies => {
                let resp = api.get("/api/v1/sobr/policies").await?;
                print_json(&resp);
            }
            SobrCmd::PolicyAdd { name, performance_tier_id, capacity_tier_id, archive_tier_id, capacity_move_days, archive_move_days, seal_days, retention_days } => {
                let resp = api.send("POST", "/api/v1/sobr/policies", Some(json!({
                    "name": name,
                    "performance_tier_id": performance_tier_id,
                    "capacity_tier_id": capacity_tier_id,
                    "archive_tier_id": archive_tier_id,
                    "capacity_move_days": capacity_move_days,
                    "archive_move_days": archive_move_days,
                    "seal_days": seal_days,
                    "retention_days": retention_days,
                }))).await?;
                print_json(&resp);
            }
            SobrCmd::Execute { id } => {
                let resp = api.send("POST", &format!("/api/v1/sobr/policies/{}/execute", id), None).await?;
                print_json(&resp);
            }
        },
        Commands::Cloud(cmd) => match cmd {
            CloudCmd::List => {
                let resp = api.get("/api/v1/cloud").await?;
                print_json(&resp);
            }
            CloudCmd::Register { name, provider, auth_type, region, access_key, secret_key, tenant_id, client_id, client_secret, project_id } => {
                let resp = api.send("POST", "/api/v1/cloud", Some(json!({
                    "name": name,
                    "provider": provider,
                    "auth_type": auth_type,
                    "region": region,
                    "status": "Connected",
                    "access_key": access_key,
                    "secret_key": secret_key,
                    "tenant_id": tenant_id,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "project_id": project_id,
                }))).await?;
                print_json(&resp);
            }
            CloudCmd::Remove { id } => {
                api.send("DELETE", &format!("/api/v1/cloud/{}", id), None).await?;
                println!("Removed cloud account: {}", id);
            }
            CloudCmd::Restorable { id } => {
                let resp = api.get(&format!("/api/v1/cloud/{}/restorable", id)).await?;
                print_json(&resp);
            }
            CloudCmd::Restores { account } => {
                let resp = match account {
                    Some(account) => api.get(&format!("/api/v1/cloud/{}/restores", account)).await?,
                    None => api.get("/api/v1/cloud/restores").await?,
                };
                print_json(&resp);
            }
            CloudCmd::Restore { account, resource_type, resource_id, target_name, subscription_id, resource_group, zone } => {
                let mut params = serde_json::Map::new();
                if let Some(subscription_id) = subscription_id {
                    params.insert("subscription_id".into(), json!(subscription_id));
                }
                if let Some(resource_group) = resource_group {
                    params.insert("resource_group".into(), json!(resource_group));
                }
                if let Some(zone) = zone {
                    params.insert("zone".into(), json!(zone));
                }
                let resp = api.send(
                    "POST",
                    &format!("/api/v1/cloud/{}/restore", account),
                    Some(json!({
                        "resource_type": resource_type,
                        "resource_id": resource_id,
                        "target_name": target_name,
                        "params": params,
                    })),
                ).await?;
                print_json(&resp);
            }
        },
        Commands::M365(cmd) => match cmd {
            M365Cmd::Tenants => {
                let resp = api.get("/api/v1/m365/tenants").await?;
                print_json(&resp);
            }
            M365Cmd::TenantAdd { name, tenant_id, client_id, client_secret, auth_type } => {
                let resp = api.send("POST", "/api/v1/m365/tenants", Some(json!({
                    "name": name,
                    "tenant_id": tenant_id,
                    "client_id": client_id,
                    "encrypted_secret": client_secret,
                    "auth_type": auth_type,
                    "status": "Connected",
                }))).await?;
                print_json(&resp);
            }
            M365Cmd::Jobs => {
                let resp = api.get("/api/v1/m365/jobs").await?;
                print_json(&resp);
            }
            M365Cmd::Backup { tenant_id, backup_type } => {
                let resp = api.send("POST", "/api/v1/m365/jobs", Some(json!({
                    "tenant_id": tenant_id,
                    "backup_type": backup_type,
                }))).await?;
                print_json(&resp);
            }
        },
        Commands::Dr(cmd) => match cmd {
            DrCmd::Status => {
                let resp = api.get("/api/v1/dr/status").await?;
                print_json(&resp);
            }
            DrCmd::Sites => {
                let resp = api.get("/api/v1/dr/sites").await?;
                print_json(&resp);
            }
            DrCmd::SiteAdd { name, dr_type, endpoint, storage_id, credentials_id } => {
                let resp = api.send("POST", "/api/v1/dr/sites", Some(json!({
                    "name": name,
                    "dr_type": dr_type,
                    "endpoint": endpoint,
                    "storage_id": storage_id,
                    "credentials_id": credentials_id,
                    "is_primary": false,
                    "status": "Online",
                }))).await?;
                print_json(&resp);
            }
            DrCmd::Plans => {
                let resp = api.get("/api/v1/dr/plans").await?;
                print_json(&resp);
            }
            DrCmd::PlanAdd { name, source_site, target_site, vms, rpo_seconds, rto_seconds } => {
                let vms: Vec<String> = vms.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                let resp = api.send("POST", "/api/v1/dr/plans", Some(json!({
                    "name": name,
                    "source_site": source_site,
                    "target_site": target_site,
                    "vms": vms,
                    "failover_order": [],
                    "auto_commit": true,
                    "test_mode": true,
                    "replication_policy": {
                        "rpo_seconds": rpo_seconds,
                        "rto_seconds": rto_seconds,
                        "compression": "zstd",
                        "encryption": true,
                        "bandwidth_throttle_mbps": 1000,
                    },
                }))).await?;
                print_json(&resp);
            }
            DrCmd::Failover { id } => {
                let resp = api.send("POST", &format!("/api/v1/dr/plans/{}/failover", id), None).await?;
                print_json(&resp);
            }
            DrCmd::Failback { id } => {
                let resp = api.send("POST", &format!("/api/v1/dr/plans/{}/failback", id), None).await?;
                print_json(&resp);
            }
            DrCmd::Test { id } => {
                let resp = api.send("POST", &format!("/api/v1/dr/plans/{}/test", id), None).await?;
                print_json(&resp);
            }
        },
        Commands::Tenant(cmd) => match cmd {
            TenantCmd::List => {
                let resp = api.get("/api/v1/tenants").await?;
                print_json(&resp);
            }
            TenantCmd::Add { name, slug } => {
                let resp = api.send("POST", "/api/v1/tenants", Some(json!({
                    "name": name,
                    "slug": slug,
                }))).await?;
                print_json(&resp);
            }
            TenantCmd::Get { id } => {
                let resp = api.get(&format!("/api/v1/tenants/{}", id)).await?;
                print_json(&resp);
            }
            TenantCmd::Delete { id } => {
                api.send("DELETE", &format!("/api/v1/tenants/{}", id), None).await?;
                println!("Deleted tenant: {}", id);
            }
            TenantCmd::Suspend { id } => {
                api.send("POST", &format!("/api/v1/tenants/{}/suspend", id), None).await?;
                println!("Tenant suspended: {}", id);
            }
            TenantCmd::Activate { id } => {
                api.send("POST", &format!("/api/v1/tenants/{}/activate", id), None).await?;
                println!("Tenant activated: {}", id);
            }
            TenantCmd::Disable { id } => {
                api.send("POST", &format!("/api/v1/tenants/{}/disable", id), None).await?;
                println!("Tenant disabled: {}", id);
            }
            TenantCmd::Quota { id, max_repositories, max_vms, max_users, max_storage_gb, max_retention_days, max_snapshots_per_vm, allow_cloud_tiers, allow_tape } => {
                let resp = api.send("PUT", &format!("/api/v1/tenants/{}/quota", id), Some(json!({
                    "max_repositories": max_repositories,
                    "max_vms": max_vms,
                    "max_users": max_users,
                    "max_storage_gb": max_storage_gb,
                    "max_retention_days": max_retention_days,
                    "max_snapshots_per_vm": max_snapshots_per_vm,
                    "allow_cloud_tiers": allow_cloud_tiers,
                    "allow_tape": allow_tape,
                }))).await?;
                print_json(&resp);
            }
            TenantCmd::Settings { id, default_retention_days, backup_window_start, backup_window_end, notify_on_failure, notify_on_success, allowed_hypervisors, allowed_storage } => {
                let hypervisors: Vec<String> = allowed_hypervisors.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                let storage: Vec<String> = allowed_storage.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                let resp = api.send("PUT", &format!("/api/v1/tenants/{}/settings", id), Some(json!({
                    "default_retention_days": default_retention_days,
                    "backup_window_start": backup_window_start,
                    "backup_window_end": backup_window_end,
                    "notify_on_failure": notify_on_failure,
                    "notify_on_success": notify_on_success,
                    "allowed_hypervisors": hypervisors,
                    "allowed_storage": storage,
                }))).await?;
                print_json(&resp);
            }
        },
        Commands::Portal(cmd) => match cmd {
            PortalCmd::Me => {
                let resp = api.get("/api/v1/portal/me").await?;
                print_json(&resp);
            }
            PortalCmd::MyRequests => {
                let resp = api.get("/api/v1/portal/restore-requests").await?;
                print_json(&resp);
            }
            PortalCmd::Submit { snapshot_id, target_path, files, reason } => {
                let files: Vec<String> = files
                    .unwrap_or_default()
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                let resp = api.send("POST", "/api/v1/portal/restore-requests", Some(json!({
                    "snapshot_id": snapshot_id,
                    "target_path": target_path,
                    "files": files,
                    "reason": reason.unwrap_or_default(),
                }))).await?;
                print_json(&resp);
            }
            PortalCmd::Cancel { id } => {
                api.send("POST", &format!("/api/v1/portal/restore-requests/{}/cancel", id), None).await?;
                println!("Restore request cancelled: {}", id);
            }
            PortalCmd::Requests => {
                let resp = api.get("/api/v1/portal/admin/restore-requests").await?;
                print_json(&resp);
            }
            PortalCmd::Approve { id, note } => {
                let resp = api.send("POST", &format!("/api/v1/portal/admin/restore-requests/{}/approve", id), Some(json!({
                    "note": note.unwrap_or_default(),
                }))).await?;
                print_json(&resp);
            }
            PortalCmd::Reject { id, note } => {
                let resp = api.send("POST", &format!("/api/v1/portal/admin/restore-requests/{}/reject", id), Some(json!({
                    "note": note.unwrap_or_default(),
                }))).await?;
                print_json(&resp);
            }
            PortalCmd::Complete { id } => {
                api.send("POST", &format!("/api/v1/portal/admin/restore-requests/{}/complete", id), None).await?;
                println!("Restore request completed: {}", id);
            }
        },
        Commands::Hypervisor(cmd) => match cmd {
            HypervisorCmd::List => {
                let resp = api.get("/api/v1/hypervisors").await?;
                print_json(&resp);
            }
            HypervisorCmd::Vms { id } => {
                let resp = api.get(&format!("/api/v1/hypervisors/{}/vms", id)).await?;
                print_json(&resp);
            }
            HypervisorCmd::Backup { id, vm_ref, repo, name, schedule, retention_days } => {
                let resp = api.send("POST", &format!("/api/v1/hypervisors/{}/vms/{}/backup", id, vm_ref), Some(json!({
                    "repository_id": repo,
                    "name": name,
                    "schedule": schedule,
                    "retention_days": retention_days,
                }))).await?;
                print_json(&resp);
            }
            HypervisorCmd::JobStatus { id } => {
                let resp = api.get(&format!("/api/v1/jobs/{}", id)).await?;
                print_json(&resp);
            }
            HypervisorCmd::InstantRecover { id, snapshot, vm_name, protocol, target_host, datastore, power_on } => {
                let resp = api.send("POST", "/api/v1/restore/instant/vm", Some(json!({
                    "snapshot_id": snapshot,
                    "vm_name": vm_name,
                    "hypervisor_id": id,
                    "protocol": protocol,
                    "target_host": target_host,
                    "datastore": if datastore.is_empty() { serde_json::Value::Null } else { json!(datastore) },
                    "power_on": power_on,
                }))).await?;
                print_json(&resp);
            }
            HypervisorCmd::InstantList => {
                let resp = api.get("/api/v1/restore/instant").await?;
                print_json(&resp);
            }
            HypervisorCmd::InstantStop { id } => {
                api.send("POST", &format!("/api/v1/restore/instant/{}/stop", id), None).await?;
                println!("Instant recovery session stopped: {}", id);
            }
        },
    }

    Ok(())
}
