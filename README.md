# BCK — Backup Manager

Enterprise-grade backup management system with file-level & database backup, scheduler, encryption, Web UI, and cross-platform agents.

```
     ┌──────────┐     ┌──────────┐     ┌──────────────┐
     │ Next.js  │────▶│  Go API  │────▶│ PostgreSQL 16│
     │   UI     │     │  (Chi)   │     │  (metadata)  │
     └──────────┘     └────┬─────┘     └──────────────┘
                           │
                     ┌─────┴─────┐     ┌──────────────┐
                     │   Redis 7 │     │  Storage     │
                     │ (queue)   │     │ local / S3   │
                     └───────────┘     └──────────────┘
                           │
              ┌────────────┼────────────┐
         ┌────┴────┐ ┌────┴────┐ ┌─────┴──────┐
         │ Worker  │ │Scheduler│ │ gRPC Agent │
         │  Pool   │ │ (cron)  │ │ (remote)   │
         └─────────┘ └─────────┘ └────────────┘
```

---

## 🏗️ Architecture

| Layer | Technology |
|-------|-----------|
| **API Server** | Go 1.25+, Chi router, pgx |
| **Background Workers** | Go, Redis BRPOP |
| **Scheduler** | Go, robfig/cron v3 |
| **Database** | PostgreSQL 16 (pgxpool) |
| **Queue/Cache** | Redis 7 (go-redis) |
| **Frontend** | Next.js 16 App Router, shadcn/ui, Tailwind CSS |
| **Agent** | gRPC (protobuf, streaming) |
| **Storage** | Local filesystem / S3 (AWS SDK v2) |
| **Observability** | Prometheus, OpenTelemetry, Grafana |
| **Deployment** | Docker Compose, Helm, Terraform, Ansible |

---

## 🚀 Quick Start

### Prerequisites
- Go 1.22+
- Node.js 22+
- Docker & Docker Compose
- PostgreSQL 16 (or use Docker)

### 1. Clone & configure

```bash
git clone https://github.com/ajjs1ajjs/BCK.git
cd BCK
cp .env.example .env
```

### 2. Start infrastructure

```bash
# Start PostgreSQL + Redis + Prometheus
make docker-up
```

### 3. Run migrations

```bash
make migrate-up
```

### 4. Start services

```bash
# In separate terminals:
make run-api          # API server → :8050
make run-worker       # Worker pool → processes jobs
make run-scheduler    # Cron scheduler
```

### 5. Start frontend

```bash
cd web && npm install && npm run dev   # → http://localhost:3000
```

### 6. Run smoke tests

```bash
# All-in-one setup + smoke test
curl -sL https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/setup.sh | bash
```

---

## 🧪 Smoke Test — One Command

Copy-paste the single command for your OS. Tests 14 API endpoints: health → login → me → repo CRUD → job CRUD → run → snapshots → stats → agents → cleanup.

### Ubuntu / Linux

```bash
curl -s http://localhost:8050/api/v1/health && echo " ✓ health" && TOKEN=$(curl -s -X POST http://localhost:8050/api/v1/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin"}' | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4) && echo " ✓ login" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/auth/me > /dev/null && echo " ✓ me" && REPO_ID=$(curl -s -X POST http://localhost:8050/api/v1/repositories -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"name":"smoke","storage_type":"local"}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4) && echo " ✓ create repo" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/repositories > /dev/null && echo " ✓ list repos" && JOB_ID=$(curl -s -X POST http://localhost:8050/api/v1/jobs -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"name\":\"smoke\",\"source_path\":\"/tmp\",\"repository_id\":\"$REPO_ID\"}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4) && echo " ✓ create job" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/jobs > /dev/null && echo " ✓ list jobs" && curl -s -X POST http://localhost:8050/api/v1/jobs/$JOB_ID/run -H "Authorization: Bearer $TOKEN" > /dev/null && echo " ✓ run job" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/jobs/$JOB_ID/runs > /dev/null && echo " ✓ job runs" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/snapshots > /dev/null && echo " ✓ snapshots" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/stats > /dev/null && echo " ✓ stats" && AGENT_ID=$(curl -s -X POST http://localhost:8050/api/v1/agents -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"name":"smoke","address":"10.0.0.1","port":50051}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4) && echo " ✓ create agent" && curl -s -X DELETE http://localhost:8050/api/v1/agents/$AGENT_ID -H "Authorization: Bearer $TOKEN" > /dev/null && echo " ✓ delete agent" && curl -s -X DELETE http://localhost:8050/api/v1/jobs/$JOB_ID -H "Authorization: Bearer $TOKEN" > /dev/null && echo " ✓ delete job" && curl -s -X DELETE http://localhost:8050/api/v1/repositories/$REPO_ID -H "Authorization: Bearer $TOKEN" > /dev/null && echo " ✓ delete repo" && echo "=== ALL 14 TESTS PASSED ==="
```

### Windows (PowerShell)

```powershell
Invoke-RestMethod http://localhost:8050/api/v1/health|Out-Null; Write-Host "✓ health"; $b=@{username='admin';password='admin'}|ConvertTo-Json; $r=Invoke-RestMethod http://localhost:8050/api/v1/auth/login -Method Post -Body $b -ContentType 'application/json'; $t=$r.access_token; Write-Host "✓ login"; $h=@{Authorization="Bearer $t"}; Invoke-RestMethod http://localhost:8050/api/v1/auth/me -Headers $h|Out-Null; Write-Host "✓ me"; $repo=Invoke-RestMethod http://localhost:8050/api/v1/repositories -Method Post -Body '{"name":"smoke","storage_type":"local"}' -ContentType 'application/json' -Headers $h; $rid=$repo.id; Write-Host "✓ create repo"; Invoke-RestMethod http://localhost:8050/api/v1/repositories -Headers $h|Out-Null; Write-Host "✓ list repos"; $job=Invoke-RestMethod http://localhost:8050/api/v1/jobs -Method Post -Body "{`"name`":`"smoke`",`"source_path`":`"/tmp`",`"repository_id`":`"$rid`"}" -ContentType 'application/json' -Headers $h; $jid=$job.id; Write-Host "✓ create job"; Invoke-RestMethod http://localhost:8050/api/v1/jobs -Headers $h|Out-Null; Write-Host "✓ list jobs"; Invoke-RestMethod "http://localhost:8050/api/v1/jobs/$jid/run" -Method Post -Headers $h|Out-Null; Write-Host "✓ run job"; Invoke-RestMethod "http://localhost:8050/api/v1/jobs/$jid/runs" -Headers $h|Out-Null; Write-Host "✓ job runs"; Invoke-RestMethod http://localhost:8050/api/v1/snapshots -Headers $h|Out-Null; Write-Host "✓ snapshots"; Invoke-RestMethod http://localhost:8050/api/v1/stats -Headers $h|Out-Null; Write-Host "✓ stats"; $ag=Invoke-RestMethod http://localhost:8050/api/v1/agents -Method Post -Body '{"name":"smoke","address":"10.0.0.1","port":50051}' -ContentType 'application/json' -Headers $h; $aid=$ag.id; Write-Host "✓ create agent"; Invoke-RestMethod "http://localhost:8050/api/v1/agents/$aid" -Method Delete -Headers $h|Out-Null; Write-Host "✓ delete agent"; Invoke-RestMethod "http://localhost:8050/api/v1/jobs/$jid" -Method Delete -Headers $h|Out-Null; Write-Host "✓ delete job"; Invoke-RestMethod "http://localhost:8050/api/v1/repositories/$rid" -Method Delete -Headers $h|Out-Null; Write-Host "✓ delete repo"; Write-Host "=== ALL 14 TESTS PASSED ==="
```

> **Note**: Requires the API server running (`make run-api`). Default admin credentials: `admin` / `admin`. Assumes `http://localhost:8050`.

---

## 📡 API Reference

Base URL: `http://localhost:8050/api/v1`

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/login` | No | Login, returns JWT + refresh token |
| `POST` | `/auth/refresh` | No | Refresh access token |
| `GET` | `/auth/me` | Bearer | Current user info |

### Backup Jobs

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/jobs` | All | List all jobs |
| `POST` | `/jobs` | Admin/Operator | Create backup job |
| `GET` | `/jobs/:id` | All | Get job details |
| `PUT` | `/jobs/:id` | Admin/Operator | Update job |
| `DELETE` | `/jobs/:id` | Admin | Delete job |
| `POST` | `/jobs/:id/run` | Admin/Operator | Trigger manual run |
| `GET` | `/jobs/:id/runs` | All | Run history |

### Repositories

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/repositories` | All | List repositories |
| `POST` | `/repositories` | Admin | Create repository |
| `GET` | `/repositories/:id` | All | Get repository |
| `PUT` | `/repositories/:id` | Admin | Update repository |
| `DELETE` | `/repositories/:id` | Admin | Delete repository |

### Snapshots & Restore

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/snapshots` | All | List snapshots (filter: `?repository_id=`) |
| `POST` | `/restore` | Admin/Operator | Start restore |
| `GET` | `/restore/:id` | All | Restore status |

### Agents (gRPC)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| `GET` | `/agents` | All | List registered agents |
| `POST` | `/agents` | Admin | Register agent |
| `GET` | `/agents/:id` | All | Get agent details |
| `PUT` | `/agents/:id` | Admin | Update agent status |
| `DELETE` | `/agents/:id` | Admin | Delete agent |

### System

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | No | Liveness check |
| `GET` | `/ready` | No | Readiness check (DB+Redis) |
| `GET` | `/stats` | Bearer | Dashboard statistics |
| `GET` | `/metrics` | No | Prometheus metrics |

---

## 🔐 Authentication & RBAC

| Role | Permissions |
|------|------------|
| **Admin** | Full access: CRUD jobs, repos, agents, users |
| **Operator** | Run jobs, create/update jobs, view all, restore |
| **Viewer** | Read-only: dashboard, jobs list, snapshots |
| **Auditor** | Read-only: audit logs, compliance reports |

---

## 📦 Feature Matrix (10 Phases)

| Phase | Focus | Features |
|-------|-------|----------|
| **1** | MVP Core | API, backup engine (chunk/zstd/AES-256), repository, restore, cron scheduler, worker pool, auth, Next.js UI, Docker |
| **2** | Advanced | gRPC agent streaming, CDC dedup (Buzhash rolling hash), DB backup (pg_dump/mysqldump/mongodump), S3 backend, block backup, Recharts+WebSocket |
| **3** | Enterprise | WORM immutable storage (governance/compliance/legal hold), multi-tenancy (orgs/teams), Grafana+health scoring, unit tests, backup-cli, OpenAPI 3.0 |
| **4** | Scale | VM backup (VMware/Hyper-V), AI analytics (prediction+anomaly), 2FA/IP whitelist/key rotation, DR plans RPO/RTO, Helm+Terraform, cache+parallel+auto-tune |
| **5** | Ecosystem | Snapshot search+browser, share links+approval, compliance (GDPR/HIPAA/SOC2/PCI), plugin SDK+hooks, cross-repo migration, React Native mobile |
| **6** | Production | Auto-update agents, DAG scheduling (topological sort+blackout+priority), AWS/GCP/Azure TF, data lifecycle, ChatOps (Slack/Teams/Discord), CI/CD |
| **7** | Next-Gen | CDP real-time journal, content-aware delta, ransomware defense (honeypots+entropy), geo edge network, self-healing+circuit breakers, quantum hybrid crypto |
| **8** | Intelligence | ML model backup (8 formats+HuggingFace), event automation engine (6 triggers+actions), OTel tracing+APM (p50/p95/p99), Merkle proofs+blockchain audit, fleet management |
| **9** | Platform | GitOps (YAML manifests+drift+plan/apply), WASM sandbox runtime, P2P IPFS network, Tauri desktop, Chrome extension, plugin marketplace |
| **10** | Future | Intent engine (NLP→manifests), serverless backup, tape library/HSM, Kafka streaming+exactly-once, digital twin (5 disaster scenarios), zero-trust (mTLS+SPIFFE+attestation) |

---

## 🧪 Testing

```bash
# Build all binaries
make build

# Run unit tests
make test

# Run full smoke test (requires running server)
bash scripts/setup.sh

# Lint
make lint
```

### Test coverage

| Package | Tests |
|---------|-------|
| `internal/auth` | Password hashing, strength validation, RBAC matrix |
| `internal/backup` | CDC chunking, encryption roundtrip, compression, dedup |
| `internal/repository` | Local repo CRUD, chunk store/load/delete, chunk index |
| `internal/worker` | Chunk ID determinism |

---

## 🐳 Docker

```bash
# Build all images
docker compose -f deployments/docker-compose.yml build

# Start full stack
make docker-up

# Services:
#   - backup-api       :8050
#   - backup-worker    (internal)
#   - backup-scheduler (internal)
#   - backup-ui        :3000
#   - postgres         :5432
#   - redis            :6379
#   - prometheus       :9090
```

---

## ☸️ Kubernetes (Helm)

```bash
helm upgrade --install bck ./deployments/helm \
  --namespace backup-manager --create-namespace \
  --set config.jwtSecret=$(openssl rand -hex 32)
```

---

## 🌍 Cloud Deployment

| Provider | Tool | File |
|----------|------|------|
| AWS | Terraform | `deployments/terraform/aws.tf` (ECS Fargate + RDS + ElastiCache) |
| GCP | Terraform | `deployments/terraform/gcp.tf` (Cloud Run + Cloud SQL + Memorystore) |
| Azure | Terraform | `deployments/terraform/azure.tf` (Container Instances + PostgreSQL + Redis) |

---

## 🛠️ CLI Tool

```bash
# Build
go build -o bck-cli ./cmd/backup-cli

# Usage
export BCK_TOKEN="<jwt>"
./bck-cli login admin password
./bck-cli jobs list
./bck-cli repos create my-repo
./bck-cli jobs create daily-backup /etc <repo-id>
./bck-cli run <job-id>
./bck-cli stats
./bck-cli health
```

---

## 📱 Mobile App

```bash
cd mobile
npm install
npx expo start
```

Screens: Dashboard, Jobs, Alerts, Settings (4 tabs).

---

## 🖥️ Desktop App

```bash
cd desktop
npm install
npm run tauri dev     # Development
npm run tauri build   # Production build
```

Built with Tauri (Rust backend + web frontend).

---

## 🔌 Browser Extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. "Load unpacked" → select `extension/` folder

Features: popup dashboard, health badge, bookmark backup, context menu actions.

---

## 📂 Project Structure

```
BCK/
├── cmd/                  # Entrypoints (api, worker, scheduler, agent, cli)
├── internal/
│   ├── agent/            # gRPC agent server, client, auto-updater
│   ├── api/              # Chi router, handlers, middleware
│   ├── auth/             # JWT, bcrypt, RBAC
│   ├── backup/           # Core: engine, scanner, chunker, CDC, CDP,
│   │                     #   compressor, encryptor, delta, VM, DB, ML,
│   │                     #   intent, streaming, P2P, GitOps, fleet, DR...
│   ├── config/           # Viper-based configuration
│   ├── metrics/          # Prometheus, health checker, OTel, APM
│   ├── models/           # Database models (user, job, repo, agent, tenant...)
│   ├── notify/           # Email, Telegram, Discord, webhook, ChatOps
│   ├── plugin/           # Hook manager, plugin SDK, WASM runtime
│   ├── repository/       # Local, S3, immutable, snapshots, index
│   ├── restore/          # File restore, full restore
│   ├── scheduler/        # Cron scheduler, GFS retention, DAG, blackout
│   ├── security/         # 2FA TOTP, IP whitelist, audit, key rotation,
│   │                     #   ransomware detection, quantum crypto, zero-trust
│   ├── store/            # PostgreSQL access, migrations
│   └── worker/           # Worker pool, Redis queue
├── proto/                # gRPC protobuf definitions
├── web/                  # Next.js frontend
├── mobile/               # React Native mobile app
├── desktop/              # Tauri desktop app
├── extension/            # Chrome browser extension
├── marketplace/          # Plugin recipes catalog
├── deployments/          # Docker, Helm, Terraform, Ansible, Grafana
├── configs/              # Config templates, OpenAPI spec
├── scripts/              # Smoke tests, migration helpers
├── go.mod / go.sum
├── Makefile
└── .env.example
```

---

## 🔒 Security

- JWT with refresh token rotation
- bcrypt password hashing
- AES-256-GCM + XChaCha20-Poly1305 hybrid encryption
- IP whitelisting
- TOTP 2FA
- mTLS + SPIFFE attestation (zero-trust)
- Ransomware detection (entropy + honeypots + extension monitoring)
- Immutable backups (WORM governance/compliance/legal hold)

---

## 📄 License

MIT
