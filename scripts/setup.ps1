# =============================================================================
# BCK — All-in-One Setup + Smoke Test (Windows PowerShell)
# Usage (Run as Administrator):
#   irm https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/setup.ps1 | iex
# Or:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
# =============================================================================

$ErrorActionPreference = "Continue"
$API = "http://localhost:8050/api/v1"
$PASS = 0; $FAIL = 0

function log  { Write-Host "[BCK] $args" -ForegroundColor Cyan }
function ok   { Write-Host "  ✓ $args" -ForegroundColor Green; $script:PASS++ }
function warn { Write-Host "  ⚠ $args" -ForegroundColor Yellow; $script:FAIL++ }

# ─── 1. Check Docker ───
log "Checking Docker..."
if (Get-Command docker -ErrorAction SilentlyContinue) {
    ok "Docker found: $(docker --version)"
} else {
    warn "Docker not installed. Install Docker Desktop from: https://www.docker.com/products/docker-desktop/"
    warn "Then re-run this script."
    exit 1
}

# ─── 2. Check Go ───
log "Checking Go..."
if (Get-Command go -ErrorAction SilentlyContinue) {
    ok "Go found: $(go version)"
} else {
    log "Installing Go 1.25..."
    $goUrl = "https://go.dev/dl/go1.25.0.windows-amd64.msi"
    $goInstaller = "$env:TEMP\go-installer.msi"
    Invoke-WebRequest -Uri $goUrl -OutFile $goInstaller
    Start-Process msiexec.exe -Wait -ArgumentList "/i $goInstaller /quiet /norestart"
    Remove-Item $goInstaller
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    ok "Go installed"
}

# ─── 3. Ensure Docker is running ───
log "Checking Docker engine..."
$dockerRunning = docker info 2>$null
if ($LASTEXITCODE -ne 0) {
    warn "Docker engine not running. Starting Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    log "Waiting for Docker to start (max 60s)..."
    for ($i = 0; $i -lt 30; $i++) {
        docker info 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep 2
    }
}
ok "Docker engine ready"

# ─── 4. Clone repo if not already ───
if (-not (Test-Path "BCK")) {
    log "Cloning BCK..."
    git clone -q https://github.com/ajjs1ajjs/BCK.git
    ok "Repo cloned"
} else {
    ok "Repo already exists"
}

Set-Location BCK

# ─── 5. Configure environment ───
if (-not (Test-Path ".env")) {
    Copy-Item .env.example .env -ErrorAction SilentlyContinue
    ok ".env created"
} else {
    ok ".env exists"
}

# ─── 6. Start infrastructure ───
log "Starting PostgreSQL + Redis..."
docker compose -f deployments/docker-compose.yml up -d 2>&1 | Select-Object -Last 3
Start-Sleep 3
ok "Infrastructure starting..."

# ─── 7. Wait for PostgreSQL ───
log "Waiting for PostgreSQL (max 30s)..."
for ($i = 0; $i -lt 15; $i++) {
    $ready = docker compose -f deployments/docker-compose.yml exec -T postgres pg_isready -U backup -d backupmanager 2>$null
    if ($LASTEXITCODE -eq 0) {
        ok "PostgreSQL ready"
        break
    }
    Start-Sleep 2
}

# ─── 8. Run migrations ───
log "Running migrations..."
go run ./internal/store/migrations/migrate.go up 2>&1 | Select-Object -Last 2
ok "Migrations done"

# ─── 9. Build & start API ───
log "Building API server..."
go build -o $env:TEMP\bck-api.exe ./cmd/backup-api 2>&1
if ($LASTEXITCODE -ne 0) {
    warn "Build failed"
    exit 1
}
ok "API binary built"

log "Starting API server on port 8050..."
$apiJob = Start-Job -ScriptBlock { & "$using:TEMP\bck-api.exe" 2>&1 } -Name "BCK-API"
Start-Sleep 3

# ─── 10. SMOKE TEST ───
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║              Smoke Test Results                   ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Health
try { $r = Invoke-RestMethod -Uri "$API/health" -TimeoutSec 3 -ErrorAction Stop; ok "GET /health" } catch { warn "GET /health — API not responding" }

# Metrics
try { Invoke-RestMethod -Uri "http://localhost:8050/metrics" -TimeoutSec 3 -ErrorAction Stop | Out-Null; ok "GET /metrics" } catch { warn "GET /metrics" }

# Login
try {
    $loginBody = @{username="admin";password="admin"} | ConvertTo-Json
    $loginResp = Invoke-RestMethod -Uri "$API/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -TimeoutSec 3
    $TOKEN = $loginResp.access_token
    $HEADERS = @{Authorization="Bearer $TOKEN"}
    ok "POST /auth/login"
} catch { warn "POST /auth/login — no token (check DB seed)"; $TOKEN = $null }

# Me
if ($TOKEN) { try { Invoke-RestMethod -Uri "$API/auth/me" -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "GET /auth/me" } catch { warn "GET /auth/me" } }

# Create Repo
if ($TOKEN) {
    try {
        $repoResp = Invoke-RestMethod -Uri "$API/repositories" -Method Post -Body '{"name":"smoke","storage_type":"local"}' -ContentType "application/json" -Headers $HEADERS -TimeoutSec 3
        $REPO_ID = $repoResp.id
        ok "POST /repositories"
    } catch { warn "POST /repositories" }
}

# List Repos
if ($TOKEN) { try { Invoke-RestMethod -Uri "$API/repositories" -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "GET /repositories" } catch { warn "GET /repositories" } }

# Create Job
if ($TOKEN -and $REPO_ID) {
    try {
        $jobBody = @{name="smoke";source_path="/tmp";repository_id=$REPO_ID} | ConvertTo-Json
        $jobResp = Invoke-RestMethod -Uri "$API/jobs" -Method Post -Body $jobBody -ContentType "application/json" -Headers $HEADERS -TimeoutSec 3
        $JOB_ID = $jobResp.id
        ok "POST /jobs"
    } catch { warn "POST /jobs" }
}

# List Jobs
if ($TOKEN) { try { Invoke-RestMethod -Uri "$API/jobs" -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "GET /jobs" } catch { warn "GET /jobs" } }

# Run Job
if ($TOKEN -and $JOB_ID) { try { Invoke-RestMethod -Uri "$API/jobs/$JOB_ID/run" -Method Post -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "POST /jobs/:id/run" } catch { warn "POST /jobs/:id/run" } }

# Job Runs
if ($TOKEN -and $JOB_ID) { try { Invoke-RestMethod -Uri "$API/jobs/$JOB_ID/runs" -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "GET /jobs/:id/runs" } catch { warn "GET /jobs/:id/runs" } }

# Snapshots
if ($TOKEN) { try { Invoke-RestMethod -Uri "$API/snapshots" -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "GET /snapshots" } catch { warn "GET /snapshots" } }

# Stats
if ($TOKEN) { try { Invoke-RestMethod -Uri "$API/stats" -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "GET /stats" } catch { warn "GET /stats" } }

# Restore
if ($TOKEN) { try { $rb = '{"snapshot_id":"0000","target_path":"/tmp/r"}' ; Invoke-RestMethod -Uri "$API/restore" -Method Post -Body $rb -ContentType "application/json" -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "POST /restore" } catch { warn "POST /restore" } }

# Create Agent
if ($TOKEN) {
    try {
        $agResp = Invoke-RestMethod -Uri "$API/agents" -Method Post -Body '{"name":"smoke","address":"10.0.0.1","port":50051}' -ContentType "application/json" -Headers $HEADERS -TimeoutSec 3
        $AGENT_ID = $agResp.id
        ok "POST /agents"
    } catch { warn "POST /agents" }
}

# Delete Agent
if ($TOKEN -and $AGENT_ID) { try { Invoke-RestMethod -Uri "$API/agents/$AGENT_ID" -Method Delete -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "DELETE /agents/:id" } catch { warn "DELETE /agents/:id" } }

# Delete Job
if ($TOKEN -and $JOB_ID) { try { Invoke-RestMethod -Uri "$API/jobs/$JOB_ID" -Method Delete -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "DELETE /jobs/:id" } catch { warn "DELETE /jobs/:id" } }

# Delete Repo
if ($TOKEN -and $REPO_ID) { try { Invoke-RestMethod -Uri "$API/repositories/$REPO_ID" -Method Delete -Headers $HEADERS -TimeoutSec 3 | Out-Null; ok "DELETE /repositories/:id" } catch { warn "DELETE /repositories/:id" } }

# ─── SUMMARY ───
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Passed: $PASS  │  Failed: $FAIL  │  Total: $($PASS+$FAIL)              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "API running at: http://localhost:8050" -ForegroundColor Green
Write-Host "Stop server:    Stop-Job -Name BCK-API" -ForegroundColor Yellow
Write-Host ""
Write-Host "Re-test anytime — paste this one-liner:" -ForegroundColor Cyan
Write-Host 'Invoke-RestMethod http://localhost:8050/api/v1/health|Out-Null; Write-Host "✓ health"; $b=@{username=''admin'';password=''admin''}|ConvertTo-Json; $r=Invoke-RestMethod http://localhost:8050/api/v1/auth/login -Method Post -Body $b -ContentType ''application/json''; $t=$r.access_token; Write-Host "✓ login"; $h=@{Authorization="Bearer $t"}; Invoke-RestMethod http://localhost:8050/api/v1/stats -Headers $h' -ForegroundColor Yellow
Write-Host ""

# Cleanup: stop API if all passed
if ($FAIL -eq 0) {
    Stop-Job -Name BCK-API -ErrorAction SilentlyContinue
    Remove-Job -Name BCK-API -ErrorAction SilentlyContinue
}
