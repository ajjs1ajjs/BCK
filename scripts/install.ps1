# =============================================================================
#  BCK Enterprise Backup - one-line Windows installer (PowerShell)
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.ps1 | iex"
#
#  Re-running the same command performs an UPDATE (binaries + web UI replaced,
#  configuration and backup data preserved).
#
#  Behavior:
#    1. Detect arch; download latest release zip from GitHub Releases.
#       If no release exists (or -FromSource), build from source (requires Rust).
#    2. Install to BCK_HOME (%ProgramFiles%\BCK).
#    3. Register bckd as a Windows service (sc create) with restart on failure.
#    4. Idempotent: safe to re-run.
# =============================================================================

[CmdletBinding()]
param(
    [string]$Version = "",
    [switch]$FromSource,
    [string]$Port = "9440"
)

$ErrorActionPreference = "Stop"
$Repo = "ajjs1ajjs/BCK"
$BCK_HOME = Join-Path $env:ProgramFiles "BCK"
$BCK_DATA = Join-Path $env:ProgramData "BCK"
$TmpDir = Join-Path $env:TEMP "bck-install"

function Log($msg) { Write-Host "[BCK] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[BCK] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[BCK] $msg" -ForegroundColor Red; exit 1 }

function Get-BinNames {
    return @("bckd.exe", "bck-agent.exe", "bck.exe", "bck-proxy.exe")
}

function Get-LatestRelease {
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 20
        return [string]$r.tag_name
    } catch {
        return ""
    }
}

function Install-FromRelease {
    param([string]$Tag)
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "x86" }
    $zip = "bck-windows-$arch.zip"
    $url = "https://github.com/$Repo/releases/download/$Tag/$zip"
    $out = Join-Path $TmpDir $zip
    Log "Downloading release $Tag ($zip)"
    Invoke-WebRequest -Uri $url -OutFile $out -TimeoutSec 60
    Expand-Archive -Path $out -DestinationPath $TmpDir -Force
    return $TmpDir
}

function Install-FromSource {
    Log "Building from source (requires Rust + MSVC toolchain)..."
    foreach ($t in @("cargo", "rustc")) {
        if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Fail "Missing: $t. Install Rust from https://rustup.rs" }
    }
    $src = Join-Path $TmpDir "BCK"
    if (-not (Test-Path $src)) {
        git clone --depth 1 "https://github.com/$Repo.git" $src
    }
    Push-Location $src
    try {
        cargo build --release --workspace --bins 2>&1 | Select-Object -Last 3
    } finally {
        Pop-Location
    }
    $binDir = Join-Path $src "target\release"
    # Build web UI if node available
    if (Test-Path (Join-Path $src "web-ui")) {
        $npm = Get-Command npm -ErrorAction SilentlyContinue
        if ($npm) {
            Log "Building web UI..."
            Push-Location (Join-Path $src "web-ui")
            try { npm ci --silent; npm run build | Out-Null } finally { Pop-Location }
        }
    }
    return $src
}

# ---------------------------------------------------------------------------
Log "BCK Enterprise Backup installer (Windows)"
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

if ($FromSource) {
    $SrcDir = Install-FromSource
} else {
    $tag = if ($Version) { $Version } else { Get-LatestRelease }
    if ($tag) {
        $SrcDir = Install-FromRelease -Tag $tag
    } else {
        Warn "No GitHub release found; building from source."
        $SrcDir = Install-FromSource
    }
}

# Locate binaries + web UI
$releaseBin = Join-Path $SrcDir "bin"
$srcBin = Join-Path $SrcDir "target\release"
if (-not (Test-Path $releaseBin)) { $releaseBin = $SrcDir }
$binDir = if (Test-Path (Join-Path $releaseBin "bckd.exe")) { $releaseBin } else { $srcBin }

New-Item -ItemType Directory -Force -Path $BCK_HOME | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $BCK_HOME "bin") | Out-Null
New-Item -ItemType Directory -Force -Path $BCK_DATA | Out-Null

# Copy binaries
foreach ($b in Get-BinNames) {
    $src = Join-Path $binDir $b
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $BCK_HOME "bin") -Force
    } else {
        Warn "Binary not found: $b (skipped)"
    }
}

# Copy web UI
$webSrc = Join-Path $SrcDir "web-ui"
if (-not (Test-Path $webSrc)) { $webSrc = Join-Path $binDir "web-ui" }
if (Test-Path $webSrc) {
    Copy-Item $webSrc (Join-Path $BCK_HOME "web-ui") -Recurse -Force
    Log "Web UI installed to $BCK_HOME\web-ui"
} else {
    Warn "web-ui not found in release (skip)."
}

# Config (preserve on update)
$configPath = Join-Path $BCK_DATA "config.toml"
if (-not (Test-Path $configPath)) {
    $dataSqlite = (Join-Path $BCK_DATA "bck.db").Replace("\", "/")
    $webDir = (Join-Path $BCK_HOME "web-ui\dist").Replace("\", "/")
    $defaultPath = (Join-Path $BCK_DATA "backups").Replace("\", "/")
    $tmpPath = (Join-Path $BCK_DATA "tmp").Replace("\", "/")
    @"
[server]
host = "0.0.0.0"
port = $Port
grpc_port = 9441
web_ui_dir = "$webDir"

[database]
url = "sqlite://$dataSqlite?mode=rwc"
pool_size = 10
migrate = true

[storage]
default_path = "$defaultPath"
temp_path = "$tmpPath"

[encryption]
algorithm = "aes-256-gcm"

[logging]
level = "info"
json = false
"@ | Set-Content -Path $configPath -Encoding UTF8
    Log "Created default config at $configPath"
} else {
    Log "Config exists - preserving it."
}

# ---------------------------------------------------------------------------
# Windows service (idempotent: stop/update/recreate/start)
$svc = Get-Service -Name "bckd" -ErrorAction SilentlyContinue
if ($svc) {
    Log "bckd service exists - stopping for update"
    Stop-Service bckd -ErrorAction SilentlyContinue
    sc.exe delete bckd | Out-Null
    Start-Sleep -Seconds 2
}

$exe = Join-Path $BCK_HOME "bin\bckd.exe"
Log "Registering service: $exe"
sc.exe create bckd binPath= "`"$exe`" -c `"$configPath`"" start= auto | Out-Null
sc.exe failure bckd reset= 0 actions= restart/5000/restart/10000/restart/30000 | Out-Null
sc.exe description bckd "BCK Enterprise Backup Daemon" | Out-Null
Start-Service bckd
Log "Service 'bckd' started."

# ---------------------------------------------------------------------------
Log "==============================================="
Log " BCK Enterprise Backup installed/updated"
Log "   Home:    $BCK_HOME"
Log "   Config:  $configPath"
Log "   Data:    $BCK_DATA"
Log "   Web UI:  http://localhost:$Port  (default login admin/admin)"
Log "   Binaries: $BCK_HOME\bin\bckd.exe, bck-agent.exe, bck.exe, bck-proxy.exe"
Log "   CLI:     bck --help"
Log "==============================================="
Log "Re-run this installer any time to update."
