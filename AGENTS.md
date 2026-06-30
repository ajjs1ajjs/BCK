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
# Unit tests (4 packages)
go test ./internal/... -short

# Full API smoke test — single command copy-paste
# Ubuntu/Linux:
curl -s http://localhost:8050/api/v1/health && echo " ✓ health" && TOKEN=$(curl -s -X POST http://localhost:8050/api/v1/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin"}' | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4) && echo " ✓ login" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/auth/me > /dev/null && echo " ✓ me" && REPO_ID=$(curl -s -X POST http://localhost:8050/api/v1/repositories -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"name":"smoke","storage_type":"local"}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4) && echo " ✓ create repo" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/repositories > /dev/null && echo " ✓ list repos" && JOB_ID=$(curl -s -X POST http://localhost:8050/api/v1/jobs -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"name\":\"smoke\",\"source_path\":\"/tmp\",\"repository_id\":\"$REPO_ID\"}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4) && echo " ✓ create job" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/jobs > /dev/null && echo " ✓ list jobs" && curl -s -X POST http://localhost:8050/api/v1/jobs/$JOB_ID/run -H "Authorization: Bearer $TOKEN" > /dev/null && echo " ✓ run job" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/jobs/$JOB_ID/runs > /dev/null && echo " ✓ job runs" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/snapshots > /dev/null && echo " ✓ snapshots" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8050/api/v1/stats > /dev/null && echo " ✓ stats" && AGENT_ID=$(curl -s -X POST http://localhost:8050/api/v1/agents -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"name":"smoke","address":"10.0.0.1","port":50051}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4) && echo " ✓ create agent" && curl -s -X DELETE http://localhost:8050/api/v1/agents/$AGENT_ID -H "Authorization: Bearer $TOKEN" > /dev/null && echo " ✓ delete agent" && curl -s -X DELETE http://localhost:8050/api/v1/jobs/$JOB_ID -H "Authorization: Bearer $TOKEN" > /dev/null && echo " ✓ delete job" && curl -s -X DELETE http://localhost:8050/api/v1/repositories/$REPO_ID -H "Authorization: Bearer $TOKEN" > /dev/null && echo " ✓ delete repo" && echo "=== ALL 14 TESTS PASSED ==="

# Windows PowerShell:
Invoke-RestMethod http://localhost:8050/api/v1/health|Out-Null; Write-Host "✓ health"; $b=@{username='admin';password='admin'}|ConvertTo-Json; $r=Invoke-RestMethod http://localhost:8050/api/v1/auth/login -Method Post -Body $b -ContentType 'application/json'; $t=$r.access_token; Write-Host "✓ login"; $h=@{Authorization="Bearer $t"}; Invoke-RestMethod http://localhost:8050/api/v1/auth/me -Headers $h|Out-Null; Write-Host "✓ me"; $repo=Invoke-RestMethod http://localhost:8050/api/v1/repositories -Method Post -Body '{"name":"smoke","storage_type":"local"}' -ContentType 'application/json' -Headers $h; $rid=$repo.id; Write-Host "✓ create repo"; Invoke-RestMethod http://localhost:8050/api/v1/repositories -Headers $h|Out-Null; Write-Host "✓ list repos"; $job=Invoke-RestMethod http://localhost:8050/api/v1/jobs -Method Post -Body "{`"name`":`"smoke`",`"source_path`":`"/tmp`",`"repository_id`":`"$rid`"}" -ContentType 'application/json' -Headers $h; $jid=$job.id; Write-Host "✓ create job"; Invoke-RestMethod http://localhost:8050/api/v1/jobs -Headers $h|Out-Null; Write-Host "✓ list jobs"; Invoke-RestMethod "http://localhost:8050/api/v1/jobs/$jid/run" -Method Post -Headers $h|Out-Null; Write-Host "✓ run job"; Invoke-RestMethod "http://localhost:8050/api/v1/jobs/$jid/runs" -Headers $h|Out-Null; Write-Host "✓ job runs"; Invoke-RestMethod http://localhost:8050/api/v1/snapshots -Headers $h|Out-Null; Write-Host "✓ snapshots"; Invoke-RestMethod http://localhost:8050/api/v1/stats -Headers $h|Out-Null; Write-Host "✓ stats"; $ag=Invoke-RestMethod http://localhost:8050/api/v1/agents -Method Post -Body '{"name":"smoke","address":"10.0.0.1","port":50051}' -ContentType 'application/json' -Headers $h; $aid=$ag.id; Write-Host "✓ create agent"; Invoke-RestMethod "http://localhost:8050/api/v1/agents/$aid" -Method Delete -Headers $h|Out-Null; Write-Host "✓ delete agent"; Invoke-RestMethod "http://localhost:8050/api/v1/jobs/$jid" -Method Delete -Headers $h|Out-Null; Write-Host "✓ delete job"; Invoke-RestMethod "http://localhost:8050/api/v1/repositories/$rid" -Method Delete -Headers $h|Out-Null; Write-Host "✓ delete repo"; Write-Host "=== ALL 14 TESTS PASSED ==="
```
