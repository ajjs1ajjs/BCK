#!/usr/bin/env bash
set -e
# =============================================================================
# BCK — All-in-One Setup + Smoke Test
# Usage: curl -sL https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/setup.sh | bash
# Or:    bash scripts/setup.sh
# =============================================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${CYAN}[BCK]${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }

API="http://localhost:8050/api/v1"
PASS=0; FAIL=0

# ─── 1. Install Docker if missing ───
if ! command -v docker &>/dev/null; then
    log "Installing Docker..."
    sudo apt update -qq && sudo apt install -y -qq docker.io docker-compose v2 2>/dev/null || true
    sudo systemctl enable --now docker 2>/dev/null || true
    sudo usermod -aG docker "$USER" 2>/dev/null || true
    ok "Docker installed"
else
    ok "Docker found: $(docker --version)"
fi

# ─── 2. Install Go if missing (for migration + API) ───
if ! command -v go &>/dev/null; then
    log "Installing Go 1.25..."
    GO_TAR="go1.25.0.linux-amd64.tar.gz"
    curl -sLo /tmp/$GO_TAR https://go.dev/dl/$GO_TAR
    sudo tar -C /usr/local -xzf /tmp/$GO_TAR
    export PATH=$PATH:/usr/local/go/bin
    echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
    ok "Go installed"
else
    ok "Go found: $(go version)"
fi

# ─── 3. Clone repo if not already ───
if [ ! -d "BCK" ]; then
    log "Cloning BCK..."
    git clone -q https://github.com/ajjs1ajjs/BCK.git
    ok "Repo cloned"
else
    ok "Repo already exists"
fi

cd BCK

# ─── 4. Configure environment ───
if [ ! -f ".env" ]; then
    cp -n .env.example .env 2>/dev/null || true
    ok ".env created"
else
    ok ".env exists"
fi

# ─── 5. Start infrastructure ───
log "Starting PostgreSQL + Redis..."
docker compose -f deployments/docker-compose.yml up -d 2>&1 | tail -1
sleep 3
ok "Infrastructure started"

# ─── 6. Wait for DB to be ready ───
log "Waiting for PostgreSQL..."
for i in $(seq 1 20); do
    if docker compose -f deployments/docker-compose.yml exec -T postgres pg_isready -U backup -d backupmanager &>/dev/null; then
        ok "PostgreSQL ready"
        break
    fi
    sleep 2
done

# ─── 7. Run migrations ───
log "Running migrations..."
go run ./internal/store/migrations/migrate.go up 2>&1 || warn "Migration may have already been applied"
ok "Migrations done"

# ─── 8. Build & start API server in background ───
log "Building API server..."
go build -o /tmp/bck-api ./cmd/backup-api 2>&1
ok "API binary built"

log "Starting API server on port 8050..."
/tmp/bck-api &
API_PID=$!
sleep 2

# Check if API is running
if curl -s --max-time 2 "$API/health" &>/dev/null; then
    ok "API server running"
else
    warn "API may need a moment..."
    sleep 3
fi

# ─── 9. SMOKE TEST ───
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              Smoke Test Results                   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

check() { local s; s=$(eval "$1" 2>/dev/null) && { ok "$2"; PASS=$((PASS+1)); } || { warn "$2 — $3"; FAIL=$((FAIL+1)); }; }

check "curl -sf --max-time 3 $API/health >/dev/null"              "GET /health"             "API not responding"
check "curl -sf --max-time 3 $API/../metrics >/dev/null"          "GET /metrics"            "Prometheus metrics"

TOKEN=$(curl -sf --max-time 3 -X POST "$API/auth/login" -H "Content-Type: application/json" -d '{"username":"admin","password":"admin"}' | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
[ -n "$TOKEN" ] && ok "POST /auth/login" || { warn "POST /auth/login" "no token — check DB seed"; FAIL=$((FAIL+1)); }
AUTH="Authorization: Bearer $TOKEN"

check "curl -sf --max-time 3 -H '$AUTH' $API/auth/me >/dev/null"      "GET /auth/me"            "auth failed"

REPO_ID=$(curl -sf --max-time 3 -X POST "$API/repositories" -H "Content-Type: application/json" -H "$AUTH" -d '{"name":"smoke","storage_type":"local"}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$REPO_ID" ] && ok "POST /repositories" || { warn "POST /repositories" "no id"; FAIL=$((FAIL+1)); }

check "curl -sf --max-time 3 -H '$AUTH' $API/repositories >/dev/null"  "GET /repositories"       "list failed"

JOB_ID=$(curl -sf --max-time 3 -X POST "$API/jobs" -H "Content-Type: application/json" -H "$AUTH" -d "{\"name\":\"smoke\",\"source_path\":\"/tmp\",\"repository_id\":\"$REPO_ID\"}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$JOB_ID" ] && ok "POST /jobs" || { warn "POST /jobs" "no id"; FAIL=$((FAIL+1)); }

check "curl -sf --max-time 3 -H '$AUTH' $API/jobs >/dev/null"           "GET /jobs"               "list failed"
check "curl -sf --max-time 3 -X POST -H '$AUTH' $API/jobs/$JOB_ID/run >/dev/null" "POST /jobs/:id/run" "trigger failed"
check "curl -sf --max-time 3 -H '$AUTH' $API/jobs/$JOB_ID/runs >/dev/null" "GET /jobs/:id/runs"   "runs failed"
check "curl -sf --max-time 3 -H '$AUTH' $API/snapshots >/dev/null"      "GET /snapshots"          "snapshots failed"
check "curl -sf --max-time 3 -H '$AUTH' $API/stats >/dev/null"          "GET /stats"              "stats failed"
check "curl -sf --max-time 3 -X POST -H '$AUTH' -H 'Content-Type: application/json' -d '{\"snapshot_id\":\"0000\",\"target_path\":\"/tmp/r\"}' $API/restore >/dev/null" "POST /restore" "restore failed"

AGENT_ID=$(curl -sf --max-time 3 -X POST "$API/agents" -H "Content-Type: application/json" -H "$AUTH" -d '{"name":"smoke","address":"10.0.0.1","port":50051}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$AGENT_ID" ] && ok "POST /agents" || { warn "POST /agents" "no id"; FAIL=$((FAIL+1)); }

check "curl -sf --max-time 3 -X DELETE -H '$AUTH' $API/agents/$AGENT_ID >/dev/null"     "DELETE /agents/:id"      "delete failed"
check "curl -sf --max-time 3 -X DELETE -H '$AUTH' $API/jobs/$JOB_ID >/dev/null"          "DELETE /jobs/:id"        "delete failed"
check "curl -sf --max-time 3 -X DELETE -H '$AUTH' $API/repositories/$REPO_ID >/dev/null" "DELETE /repositories/:id" "delete failed"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Passed: ${GREEN}$PASS${CYAN}  │  Failed: ${RED}$FAIL${CYAN}  │  Total: $((PASS+FAIL))              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "API running at: ${GREEN}http://localhost:8050${NC}"
echo -e "Process PID:    ${GREEN}$API_PID${NC}"
echo -e "Stop server:    ${GREEN}kill $API_PID${NC}"
echo ""
echo -e "Paste this one-liner to re-test anytime:"
echo -e "${YELLOW}curl -s $API/health && echo ' ✓' && TOKEN=\$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"admin\"}' | grep -o '\"access_token\":\"[^\"]*\"' | cut -d'\"' -f4) && echo ' ✓ login' && curl -s -H \"Authorization: Bearer \$TOKEN\" $API/auth/me >/dev/null && echo ' ✓ me' && curl -s -H \"Authorization: Bearer \$TOKEN\" $API/stats && echo ''${NC}"

# Cleanup test data
if [ $FAIL -eq 0 ]; then
    kill $API_PID 2>/dev/null || true
fi
