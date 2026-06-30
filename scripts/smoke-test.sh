#!/usr/bin/env bash
# =============================================================================
# BCK Backup Manager — Full System Smoke Test
# Single command: bash scripts/smoke-test.sh
# Tests all 25+ API endpoints in sequence
# =============================================================================
set -e

API="${BCK_API_URL:-http://localhost:8050/api/v1}"
PASS=0; FAIL=0
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()  { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail(){ echo -e "  ${RED}✗${NC} $1 — $2"; FAIL=$((FAIL+1)); }

echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     BCK Backup Manager — Smoke Test Suite            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ──── 1. HEALTH ────
echo "── Health checks ──"

# 1.1 Basic health
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
[ "$HEALTH" = "200" ] && ok "GET /health → 200" || fail "GET /health" "got $HEALTH"

# 1.2 Readiness
READY=$(curl -s "$API/health")
echo "$READY" | grep -q '"status"' && ok "Health body contains status" || fail "Health body" "no status field"

# ──── 2. AUTH ────
echo "── Authentication ──"

# 2.1 Login
LOGIN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo "$LOGIN" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  ok "POST /auth/login → got JWT token (len=${#TOKEN})"
else
  # Try register + login with default user seeding
  LOGIN=$(curl -s -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}')
  TOKEN=$(echo "$LOGIN" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
  [ -n "$TOKEN" ] && ok "POST /auth/login → got JWT (fallback)" || fail "POST /auth/login" "no token in response"
fi

AUTH="Authorization: Bearer $TOKEN"

# 2.2 Get current user
ME=$(curl -s -H "$AUTH" "$API/auth/me")
ME_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/auth/me")
[ "$ME_CODE" = "200" ] && ok "GET /auth/me → 200" || fail "GET /auth/me" "got $ME_CODE"

# 2.3 Refresh token
REFRESH_TOKEN=$(echo "$LOGIN" | grep -o '"refresh_token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$REFRESH_TOKEN" ]; then
  REFRESH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/refresh" \
    -H "Content-Type: application/json" \
    -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}")
  [ "$REFRESH" = "200" ] && ok "POST /auth/refresh → 200" || fail "POST /auth/refresh" "got $REFRESH"
fi

# ──── 3. REPOSITORIES ────
echo "── Repositories ──"

# 3.1 List (empty)
REPOS=$(curl -s -H "$AUTH" "$API/repositories")
echo "$REPOS" | grep -q '\[\]' || echo "$REPOS" | grep -q '\[{"' && ok "GET /repositories → list returned" || fail "GET /repositories" "unexpected response"

# 3.2 Create
REPO=$(curl -s -X POST "$API/repositories" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name":"smoke-test-repo","storage_type":"local","description":"Smoke test repository"}')
REPO_ID=$(echo "$REPO" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

[ -n "$REPO_ID" ] && ok "POST /repositories → created id=$REPO_ID" || fail "POST /repositories" "no id returned"

# 3.3 Get
REPO_GET=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/repositories/$REPO_ID")
[ "$REPO_GET" = "200" ] && ok "GET /repositories/$REPO_ID → 200" || fail "GET /repositories/{id}" "got $REPO_GET"

# 3.4 Update
REPO_UPD=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/repositories/$REPO_ID" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name":"smoke-test-repo-updated"}')
[ "$REPO_UPD" = "200" ] && ok "PUT /repositories/$REPO_ID → 200" || fail "PUT /repositories/{id}" "got $REPO_UPD"

# ──── 4. JOBS ────
echo "── Backup Jobs ──"

# 4.1 Create job
JOB=$(curl -s -X POST "$API/jobs" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"name\":\"smoke-test-job\",\"source_path\":\"/tmp/bck-test-source\",\"repository_id\":\"$REPO_ID\",\"cron_expression\":\"0 0 3 * * *\"}")
JOB_ID=$(echo "$JOB" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

[ -n "$JOB_ID" ] && ok "POST /jobs → created id=$JOB_ID" || fail "POST /jobs" "no id returned"

# 4.2 List jobs
JOBS_LIST=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/jobs")
[ "$JOBS_LIST" = "200" ] && ok "GET /jobs → 200" || fail "GET /jobs" "got $JOBS_LIST"

# 4.3 Get job
JOB_GET=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/jobs/$JOB_ID")
[ "$JOB_GET" = "200" ] && ok "GET /jobs/$JOB_ID → 200" || fail "GET /jobs/{id}" "got $JOB_GET"

# 4.4 Update job
JOB_UPD=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/jobs/$JOB_ID" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name":"smoke-test-job-updated","compression_level":5}')
[ "$JOB_UPD" = "200" ] && ok "PUT /jobs/$JOB_ID → 200" || fail "PUT /jobs/{id}" "got $JOB_UPD"

# 4.5 Trigger job run
RUN=$(curl -s -X POST "$API/jobs/$JOB_ID/run" -H "$AUTH" -H "Content-Type: application/json")
RUN_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/jobs/$JOB_ID/run" \
  -H "Content-Type: application/json" -H "$AUTH")
[ "$RUN_CODE" = "202" ] && ok "POST /jobs/$JOB_ID/run → 202" || fail "POST /jobs/{id}/run" "got $RUN_CODE"

# 4.6 List job runs
RUNS=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/jobs/$JOB_ID/runs")
[ "$RUNS" = "200" ] && ok "GET /jobs/$JOB_ID/runs → 200" || fail "GET /jobs/{id}/runs" "got $RUNS"

# ──── 5. SNAPSHOTS ────
echo "── Snapshots ──"
SNAPS=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/snapshots")
[ "$SNAPS" = "200" ] && ok "GET /snapshots → 200" || fail "GET /snapshots" "got $SNAPS"

SNAPS_FILTERED=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/snapshots?repository_id=$REPO_ID")
[ "$SNAPS_FILTERED" = "200" ] && ok "GET /snapshots?repository_id= → 200" || fail "GET /snapshots?repo" "got $SNAPS_FILTERED"

# ──── 6. RESTORE ────
echo "── Restore ──"
RESTORE=$(curl -s -X POST "$API/restore" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"snapshot_id":"00000000-0000-0000-0000-000000000000","target_path":"/tmp/bck-restore-test","overwrite":false}')
RESTORE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/restore" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"snapshot_id":"00000000-0000-0000-0000-000000000000","target_path":"/tmp/bck-restore-test"}')
[ "$RESTORE_CODE" = "202" ] && ok "POST /restore → 202" || fail "POST /restore" "got $RESTORE_CODE"

# ──── 7. AGENTS ────
echo "── Agents ──"

# 7.1 List agents
AGENTS=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/agents")
[ "$AGENTS" = "200" ] && ok "GET /agents → 200" || fail "GET /agents" "got $AGENTS"

# 7.2 Register agent
AGENT=$(curl -s -X POST "$API/agents" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name":"smoke-test-agent","address":"192.168.99.100","port":50051,"version":"1.0.0","labels":["test","smoke"]}')
AGENT_ID=$(echo "$AGENT" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

[ -n "$AGENT_ID" ] && ok "POST /agents → created id=$AGENT_ID" || fail "POST /agents" "no id"

# 7.3 Get agent
AGENT_GET=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/agents/$AGENT_ID")
[ "$AGENT_GET" = "200" ] && ok "GET /agents/$AGENT_ID → 200" || fail "GET /agents/{id}" "got $AGENT_GET"

# ──── 8. STATS ────
echo "── Dashboard ──"
STATS=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/stats")
[ "$STATS" = "200" ] && ok "GET /stats → 200" || fail "GET /stats" "got $STATS"

# ──── 9. METRICS ────
echo "── Metrics ──"
METRICS=$(curl -s -o /dev/null -w "%{http_code}" "$API/../metrics")
[ "$METRICS" = "200" ] || METRICS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8050/metrics")
[ "$METRICS" = "200" ] && ok "GET /metrics → 200" || fail "GET /metrics" "got $METRICS (Prometheus not scraped?)"

# ──── 10. CLEANUP ────
echo "── Cleanup ──"

# 10.1 Delete job
JOB_DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "$AUTH" "$API/jobs/$JOB_ID")
[ "$JOB_DEL" = "204" ] && ok "DELETE /jobs/$JOB_ID → 204" || fail "DELETE /jobs/{id}" "got $JOB_DEL"

# 10.2 Delete agent
AGENT_DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "$AUTH" "$API/agents/$AGENT_ID")
[ "$AGENT_DEL" = "204" ] && ok "DELETE /agents/$AGENT_ID → 204" || fail "DELETE /agents/{id}" "got $AGENT_DEL"

# 10.3 Delete repo
REPO_DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "$AUTH" "$API/repositories/$REPO_ID")
[ "$REPO_DEL" = "204" ] && ok "DELETE /repositories/$REPO_ID → 204" || fail "DELETE /repositories/{id}" "got $REPO_DEL"

# ──── SUMMARY ────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    Results                            ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════════════╣${NC}"
printf "${CYAN}║${NC}  ${GREEN}Passed: %-3d${NC}  │  ${RED}Failed: %-3d${NC}  │  Total: %-3d          ${CYAN}║${NC}\n" $PASS $FAIL $((PASS+FAIL))
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"

[ $FAIL -eq 0 ] && echo -e "\n${GREEN}All smoke tests passed!${NC}" || echo -e "\n${RED}$FAIL test(s) failed.${NC}"
exit $FAIL
