# BCK — Agent Instructions

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
| `internal/backup/` | Core backup engine — scanner, chunker (fixed + CDC), compressor (zstd), encryptor (AES-256), engine |
| `internal/api/` | HTTP handlers + middleware (auth, RBAC, logging, rate limiting) |
| `internal/repository/` | Storage backends: local filesystem, S3, immutable (WORM) |
| `internal/scheduler/` | Cron scheduling, retention policies, DAG dependencies |
| `internal/worker/` | Redis-based job queue processor |
| `internal/auth/` | JWT tokens, bcrypt password hashing, RBAC matrix |
| `web/` | Next.js frontend (TypeScript) |

### API Pattern
- All handlers in `internal/api/handlers/`
- Routes defined in `internal/api/router.go`
- Middleware: `internal/api/middleware/`
- Models: `internal/models/`
- DB access: `internal/store/`

### Running
```bash
make docker-up       # Start postgres + redis + prometheus
make migrate-up      # Apply migrations
make run-api         # Terminal 1
make run-worker      # Terminal 2
make run-scheduler   # Terminal 3
cd web && npm run dev # Terminal 4
```

### Testing
```bash
go test ./internal/... -short    # Unit tests (4 packages)
bash scripts/smoke-test.sh       # Full API smoke test (requires running server)
```
