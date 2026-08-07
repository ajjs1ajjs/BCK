# BCK Enterprise — Backup & Disaster Recovery

Enterprise-grade backup and disaster recovery system (Veeam / Nakivo alternative), built entirely in Rust.

> **Status: all phases complete.** Core engine, storage, REST + gRPC APIs, Web UI, CLI, agent, proxy, VMware/Hyper-V backup + instant recovery, SOBR, Tape, M365, Cloud (AWS/Azure/GCP/K8s), CDP, DR, SSO, audit, reports and multi-tenancy are implemented and covered by 154 passing tests.

## Features

| Area | Capabilities |
|------|--------------|
| **Backup engine** | Scanner → chunker (XXH3) → dedup (SHA-256) → compress (LZ4/Zstd) → encrypt (AES-256-GCM / ChaCha20-Poly1305) |
| **Storage** | Local FS, S3 (SigV4), Azure Blob, GCS, Tape (LTFS) |
| **VMware / Hyper-V** | CBT/RCT changed-block tracking, snapshots, power on/off, **full VM backup jobs via REST**, **instant recovery** (VM boots from backup via NFS/iSCSI) |
| **Cloud** | AWS (EC2/EBS/RDS), Azure (VM/disk/SQL), GCP (GCE/disk/SQL), K8s (PVC); cloud restore via API |
| **Enterprise** | SOBR tiers + lifecycle, Tape LTFS, M365 (mailbox/OneDrive/SharePoint), CDP, DR failover, SureBackup validation |
| **Security & governance** | JWT + Argon2, SSO (OIDC + LDAP), audit log, SLA/CSV reports, multi-tenancy, self-service restore portal |
| **Interfaces** | REST API (Axum), gRPC (Tonic), Web UI (React + MUI), CLI, agent, backup proxy |

## Architecture

| Component | Description | Technology |
|-----------|-------------|-----------|
| **bckd** | Main daemon: REST API + gRPC + scheduler | Rust (Axum + Tonic) |
| **bck-agent** | Agent for protected machines | Rust |
| **bck-proxy** | Backup proxy (SAN, NFS, HotAdd) | Rust |
| **bck** | Management CLI | Rust (clap) |
| **web-ui** | Web management interface | React + TypeScript |
| **Database** | PostgreSQL (SQLite for single-node) | sqlx |
| **Storage** | Local FS, S3, Azure Blob, GCS, Tape | Rust |

### Ports

| Port | Service |
|------|---------|
| 9440 | REST API + Web UI |
| 9441 | gRPC API |

## Quick Start

```bash
# Build
cargo build --release

# Run daemon (SQLite standalone)
./target/release/bckd

# Or with PostgreSQL + MinIO (Docker)
docker compose up -d

# Login via CLI and check status
bck --server http://127.0.0.1:9440 status
```

Default web console: `http://localhost:9440` (login `admin` / `admin`).

## One-line Install & Update

Install **and update** with a single command — re-running the same command upgrades the daemon, agent, CLI, proxy and web UI **in place**, while preserving your configuration and backup data.

**Linux / macOS**
```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.sh | bash
```

**Windows (PowerShell)**
```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.ps1 | iex"
```

What the installer does:

1. Downloads the latest GitHub release for your OS/arch. When no release exists yet (or `--from-source` / `-FromSource` is passed) it **builds from source** — installing the Rust toolchain and system build dependencies automatically on a fresh Linux/macOS machine (requires root for `apt`/`dnf`/`apk` installs).
2. Installs `bckd`, `bck-agent`, `bck`, `bck-proxy` and the web console to `BCK_HOME` (`/opt/bck` on Linux/macOS, `%ProgramFiles%\BCK` on Windows).
3. Creates a default config (`/etc/bck/config.toml` on Linux, `%ProgramData%\BCK\config.toml` on Windows) — existing config is **preserved** on update.
4. Registers `bckd` as a systemd service (Linux), launchd agent (macOS) or Windows service (with restart-on-failure).
5. Symlinks the binaries into `PATH`.

> **Note on source builds:** if npm/Node.js is not installed the web console is skipped (daemon + CLI + agent still work, REST API and gRPC are available). The first source build takes several minutes as it compiles all crates.

The same command is used for fresh installs and upgrades, so you can script regular updates:

```bash
# Add a weekly update (Linux/macOS)
0 3 * * 0  curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.sh | bash
```

**Verify installation:**

```bash
bck --server http://127.0.0.1:9440 status      # daemon health + stats
curl http://127.0.0.1:9440/api/v1/dashboard/stats
```

## CLI

```bash
# Jobs
bck job create "Daily Backup" /data my-repo
bck job list
bck job run <id>
bck job cancel <id>
bck job status <id>

# Repositories
bck repo list
bck repo add <name> <type> <path>

# Snapshots & restore
bck snapshot list <job_id>
bck snapshot delete <id>
bck restore <snapshot_id> <target> --files <file1,file2> --overwrite

# System
bck status
bck logs --tail

# Phase 4-6 management
bck sobr tiers
bck sobr tier add <name> --tier-type Capacity --backend local --capacity 1000000000000
bck sobr policies
bck sobr policy add <name> --performance-tier-id <id> --capacity-tier-id <id>
bck cloud list
bck cloud register <name> --provider aws --auth-type access_key --region us-east-1
bck m365 tenants
bck m365 tenant add <name> --tenant-id <tid> --client-id <cid> --client-secret <sec>
bck m365 jobs
bck dr sites
bck dr plans
bck dr failover <plan_id>
bck tenant list
bck tenant add <name> <slug>
bck portal my-requests
bck portal requests

# VMware / Hyper-V
bck hypervisor list
bck hypervisor vms <hypervisor_id>
bck hypervisor backup <hypervisor_id> --vm-ref <ref> --repo <repo_id>
bck hypervisor instant-recover <hypervisor_id> --snapshot <id> --vm-name <name> --protocol nfs
bck hypervisor instant-list
bck hypervisor instant-stop <session_id>
```

## Web UI

13 pages: Dashboard, Backup Jobs, Repositories, Snapshots, Restore, SOBR, Cloud, Microsoft 365, Tape Library, Disaster Recovery, Tenants, Hypervisors & VMs, Self-service portal (plus Administration with SSO / audit / reports).

## API Endpoints

```
POST   /api/v1/auth/login
GET    /api/v1/dashboard/stats

GET    /api/v1/jobs
POST   /api/v1/jobs
GET    /api/v1/jobs/:id
PUT    /api/v1/jobs/:id
DELETE /api/v1/jobs/:id
POST   /api/v1/jobs/:id/run
POST   /api/v1/jobs/:id/cancel

GET    /api/v1/repositories
POST   /api/v1/repositories
GET    /api/v1/snapshots
GET    /api/v1/snapshots/:id
DELETE /api/v1/snapshots/:id

POST   /api/v1/restore/file
POST   /api/v1/restore/vm
POST   /api/v1/restore/instant
POST   /api/v1/restore/instant/vm
GET    /api/v1/restore/instant
POST   /api/v1/restore/instant/:id/stop
GET    /api/v1/restore/explore/:snapshot_id
GET    /api/v1/restore/explore/:snapshot_id/file
POST   /api/v1/restore/surebackup
GET    /api/v1/restore/surebackup
GET    /api/v1/restore/session/:id

GET    /api/v1/hypervisors
POST   /api/v1/hypervisors
GET    /api/v1/hypervisors/:id
DELETE /api/v1/hypervisors/:id
POST   /api/v1/hypervisors/:id/test
GET    /api/v1/hypervisors/:id/vms
POST   /api/v1/hypervisors/:id/vms/:vm_ref/backup

GET    /api/v1/sobr
POST   /api/v1/sobr/tiers
GET    /api/v1/sobr/policies
POST   /api/v1/sobr/policies
POST   /api/v1/sobr/policies/:id/execute

GET    /api/v1/cloud
POST   /api/v1/cloud
GET    /api/v1/cloud/:id
DELETE /api/v1/cloud/:id
GET    /api/v1/cloud/:id/restorable
POST   /api/v1/cloud/:id/restore
GET    /api/v1/cloud/:id/restores
GET    /api/v1/cloud/restores
GET    /api/v1/cloud/restores/:rid

GET    /api/v1/m365/tenants
POST   /api/v1/m365/tenants
GET    /api/v1/m365/jobs
POST   /api/v1/m365/jobs

GET    /api/v1/tape/drives
POST   /api/v1/tape/drives
GET    /api/v1/tape/media
POST   /api/v1/tape/media
POST   /api/v1/tape/retention

GET    /api/v1/cdp/policies
POST   /api/v1/cdp/policies
POST   /api/v1/cdp/policies/:id/start
GET    /api/v1/cdp/sessions
POST   /api/v1/cdp/sessions/:id/stop

GET    /api/v1/dr/status
GET    /api/v1/dr/sites
POST   /api/v1/dr/sites
GET    /api/v1/dr/plans
POST   /api/v1/dr/plans
POST   /api/v1/dr/plans/:id/failover
POST   /api/v1/dr/plans/:id/failback
POST   /api/v1/dr/plans/:id/test

GET    /api/v1/tenants
POST   /api/v1/tenants
GET    /api/v1/tenants/:id
DELETE /api/v1/tenants/:id
POST   /api/v1/tenants/:id/suspend
PUT    /api/v1/tenants/:id/quota
PUT    /api/v1/tenants/:id/settings
GET    /api/v1/tenants/:id/usage

GET    /api/v1/portal/me
GET    /api/v1/portal/restore-requests
POST   /api/v1/portal/restore-requests
POST   /api/v1/portal/restore-requests/:id/cancel
GET    /api/v1/portal/admin/restore-requests
POST   /api/v1/portal/admin/restore-requests/:id/approve
POST   /api/v1/portal/admin/restore-requests/:id/reject
POST   /api/v1/portal/admin/restore-requests/:id/complete

GET    /api/v1/events
GET    /api/v1/agents
POST   /api/v1/agents/:id/tasks
```

## gRPC

The daemon exposes the following services on port **9441** (all backed by the real engine / database):

| Service | Methods |
|---------|---------|
| `BackupEngine` | StartJob, CancelJob, StreamProgress, ListSnapshots, ValidateConfig, Restore, RestoreFile, InstantRecovery, GetStats, CheckHealth, GetRepositoryStats |
| `SobrService` | ListTiers, AddTier, ListPolicies, CreatePolicy, GetTierStats |
| `CloudService` | ListAccounts, RegisterAccount, RemoveAccount, GetAccount, ListRestorableKinds, SubmitRestore, ListRestores |
| `M365Service` | ListTenants, RegisterTenant, ListBackupJobs, StartBackup |
| `Agent` | Heartbeat, StartBackup, StartRestore, ExecuteScript, GetStatus, UpdateAgent |

## Development

```bash
# Check compilation
cargo check

# Run tests (154 in bck-core)
cargo test

# Run daemon in dev mode
RUST_LOG=debug cargo run -p bckd

# Run web UI dev server
cd web-ui && npm install && npm run dev
```

## License

MIT
