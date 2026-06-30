# BCK — Backup Manager

Enterprise backup management system with file-level backup & restore, scheduler, encryption, and Web UI.

## Architecture

- **Backend**: Go (Chi router, pgx, go-redis)
- **Frontend**: Next.js 14+ (App Router, shadcn/ui, Tailwind CSS)
- **Database**: PostgreSQL 16
- **Queue/Cache**: Redis 7
- **Agent**: gRPC (streaming, bi-directional)
- **Storage**: Local filesystem (S3 in Phase 2)

## Quick Start

```bash
# Copy environment config
cp .env.example .env

# Start dependencies
make docker-up

# Run migrations
make migrate-up

# Start services
make run-api      # Terminal 1
make run-worker   # Terminal 2
make run-scheduler # Terminal 3

# Frontend
cd web && npm run dev
```

## API Endpoints

Base: `http://localhost:8080/api/v1`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login, get JWT |
| POST | `/auth/refresh` | Refresh token |
| GET | `/auth/me` | Current user |
| GET/POST | `/jobs` | List / Create backup jobs |
| GET/PUT/DELETE | `/jobs/:id` | Job CRUD |
| POST | `/jobs/:id/run` | Trigger job manually |
| GET | `/jobs/:id/runs` | Job execution history |
| GET/POST | `/repositories` | List / Create repos |
| GET/PUT/DELETE | `/repositories/:id` | Repo CRUD |
| POST | `/restore` | Start restore |
| GET | `/restore/:id` | Restore status |
| GET | `/snapshots` | List snapshots |
| GET | `/health` | Health check |
| GET | `/stats` | Dashboard stats |
| GET | `/metrics` | Prometheus metrics |

## License

MIT
