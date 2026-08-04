# BCK Enterprise — Backup & Disaster Recovery

Enterprise-grade backup and disaster recovery system (Veeam / Nakivo alternative), built entirely in Rust.

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

## Quick Start

```bash
# Build
cargo build --release

# Run daemon (SQLite standalone)
./target/release/bckd

# Or with PostgreSQL + MinIO (Docker)
docker compose up -d
```

## One-line Install

Install (or update — re-running the same command upgrades in place, preserving config and backup data):

**Linux / macOS**
```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.sh | bash
```

**Windows (PowerShell)**
```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.ps1 | iex"
```

The installer downloads the latest release for your platform, installs the daemon, agent, CLI and web console, creates a default config, and registers the daemon as a systemd service (Linux) / Windows service. Re-running it performs an **update**.

Build-from-source fallback (when no release exists yet):
```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.sh | bash -s -- --from-source
```

After install, open the web console at `http://localhost:9440` (default login `admin` / `admin`).

## Development

```bash
# Check compilation
cargo check

# Run tests
cargo test

# Run daemon in dev mode
RUST_LOG=debug cargo run -p bckd
```

## CLI

```bash
# Create backup job
bck job create "Daily Backup" /data my-repo

# Run job
bck job run <id>

# Status
bck status
```

## API Endpoints

```
GET    /api/v1/jobs
POST   /api/v1/jobs
GET    /api/v1/jobs/:id
POST   /api/v1/jobs/:id/run
POST   /api/v1/jobs/:id/cancel
GET    /api/v1/repositories
GET    /api/v1/snapshots
POST   /api/v1/restore
GET    /api/v1/dashboard/stats
POST   /api/v1/auth/login
```

## License

MIT
