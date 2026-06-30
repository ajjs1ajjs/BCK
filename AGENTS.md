# BCK — Agent Instructions

## One-Command Setup
```bash
# Ubuntu
curl -sL https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/setup.sh | bash

# Windows (Admin)
irm https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/setup.ps1 | iex
```

## Build Commands
```bash
go build ./...                    # Build all Go packages
go test ./internal/... -short     # Run unit tests
cd web && npm run build           # Build Next.js frontend
make build                        # Build all binaries
```

## Project Overview
BCK is an enterprise backup management system written in **Go** with a **Next.js** frontend.

### Stack
- **Backend**: Go 1.25+, Chi router, pgx (PostgreSQL), go-redis
- **Frontend**: Next.js 16 App Router, shadcn/ui, Tailwind CSS v4
- **Infra**: Docker Compose, PostgreSQL 16, Redis 7, Prometheus

### Key Directories
| Directory | Purpose |
|-----------|---------|
| `cmd/` | Entrypoints: backup-api, backup-worker, backup-scheduler, backup-agent, backup-cli |
| `internal/backup/` | Core backup engine — scanner, chunker, compressor (zstd), encryptor (AES-256) |
| `internal/api/` | HTTP handlers + middleware (auth, RBAC, logging, rate limiting) |
| `internal/repository/` | Storage backends: local, S3, immutable (WORM) |
| `internal/scheduler/` | Cron scheduling, retention policies, DAG |
| `internal/worker/` | Redis-based job queue processor |
| `internal/auth/` | JWT tokens, bcrypt, RBAC matrix |
| `web/` | Next.js frontend (TypeScript) |

### Running
```bash
make docker-up        # Start postgres + redis + prometheus
make migrate-up       # Apply migrations
make run-api          # API server → :8050
make run-worker       # Worker pool
make run-scheduler    # Cron scheduler
cd web && npm run dev # Frontend → :3000
```

### Testing
```bash
go test ./internal/... -short     # Unit tests
bash scripts/setup.sh             # Full setup + smoke test
```
