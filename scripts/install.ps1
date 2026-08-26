<#
.SYNOPSIS
    BCK Enterprise Backup - one-line installer for Windows (PowerShell).

.DESCRIPTION
    Mirrors scripts/install.sh for Ubuntu/Debian.

    Usage:
      irm https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.ps1 | iex

    Or locally:
      powershell -ExecutionPolicy Bypass -File scripts\install.ps1
      powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -FromSource
      powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Version v0.1.0

    Re-running performs an UPDATE (binaries + web UI replaced, config and
    backup data preserved). Registers a Windows service 'bckd'.

.PARAMETER FromSource
    Build from source instead of downloading a release archive.

.PARAMETER Version
    Specific release tag (default: latest GitHub release).
#>
[CmdletBinding()]
param(
    [switch]$FromSource,
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------- settings ---
$Repo       = "ajjs1ajjs/BCK"
$BckHome    = if ($env:BCK_HOME)        { $env:BCK_HOME }        else { Join-Path $env:ProgramFiles "BCK" }
$BckDataDir = if ($env:BCK_DATA_DIR)    { $env:BCK_DATA_DIR }    else { Join-Path $env:ProgramData "bck" }
$BckPort    = if ($env:BCK_PORT)        { $env:BCK_PORT }        else { "9440" }
$BinNames   = @("bckd.exe", "bck-agent.exe", "bck.exe", "bck-proxy.exe")

function Log  { param($m) Write-Host "[BCK] $m" -ForegroundColor Cyan }
function Warn { param($m) Write-Host "[BCK] $m" -ForegroundColor Yellow }
function Fail { param($m) Write-Host "[BCK] $m" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------- elevation -----
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Log "Not running as Administrator - re-launching elevated..."
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath)
    if ($FromSource) { $argList += "-FromSource" }
    if ($Version)    { $argList += "-Version"; $argList += $Version }
    Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait
    exit $LASTEXITCODE
}

# --------------------------------------------------------------- helpers -----
function Get-LatestRelease {
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 20
        return $r.tag_name
    } catch { return "" }
}

function Ensure-Rust {
    if (Get-Command cargo -ErrorAction SilentlyContinue) {
        Log "Rust toolchain present ($(cargo --version))."
        return
    }
    Log "Installing Rust toolchain (rustup)..."
    $rustupInit = Join-Path $env:TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupInit -TimeoutSec 120
    & $rustupInit -y --profile minimal | Out-Null
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Fail "Rust installed but 'cargo' not on PATH yet. Open a new shell and re-run."
    }
}

function Ensure-BuildDeps {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Fail "git not found. Install it: winget install Git.Git   (then re-run)"
    }
    if (-not (Get-Command protoc -ErrorAction SilentlyContinue)) {
        Warn "protoc not found. Install it: winget install protobuf  OR choco install protoc"
        Fail "protoc is required to build bck-core."
    }
    # MSVC linker comes with Visual Studio Build Tools; warn early if missing.
    if (-not (Get-Command link.exe -ErrorAction SilentlyContinue) -and -not (Test-Path "$env:ProgramFiles\Microsoft Visual Studio")) {
        Warn "MSVC Build Tools may be missing. If the build fails, run:"
        Warn "  winget install Microsoft.VisualStudio.2022.BuildTools --override '--add Microsoft.VisualStudio.Workload.VCTools'"
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Warn "npm not found - web console will be skipped (daemon/CLI/agent still work)."
        Warn "Install Node.js for the web UI: winget install OpenJS.NodeJS.LTS"
    }
}

# ------------------------------------------------------------- download ------
$TmpDir = Join-Path ([IO.Path]::GetTempPath()) ("bck-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TmpDir | Out-Null
try {
    $Mode = "release"
    if ($FromSource) { $Mode = "source" }

    if ($Mode -eq "release") {
        $Tag = if ($Version) { $Version } else { Get-LatestRelease }
        if ($Tag) {
            $Archive = "bck-windows-x86_64.zip"
            $Url = "https://github.com/$Repo/releases/download/$Tag/$Archive"
            Log "Downloading release $Tag ($Archive)..."
            try {
                Invoke-WebRequest -Uri $Url -OutFile (Join-Path $TmpDir $Archive) -TimeoutSec 300
                Expand-Archive -Path (Join-Path $TmpDir $Archive) -DestinationPath $TmpDir -Force
                Log "Release binaries staged."
            } catch {
                Warn "Release download failed; building from source instead."
                $Mode = "source"
            }
        } else {
            Warn "No GitHub release found; building from source instead."
            $Mode = "source"
        }
    }

    if ($Mode -eq "source") {
        Log "Building from source (Rust + MSVC required)..."
        Ensure-Rust
        Ensure-BuildDeps
        $SrcDir = Join-Path $TmpDir "BCK"
        if (Test-Path (Join-Path $SrcDir ".git")) {
            Push-Location $SrcDir
            git fetch --depth 1 origin main; git reset --hard origin/main
            Pop-Location
        } else {
            git clone --depth 1 --branch main "https://github.com/$Repo.git" $SrcDir
        }
        Push-Location $SrcDir
        try {
            Log "Compiling release binaries (this takes several minutes)..."
            cargo build --release --workspace --bins
            New-Item -ItemType Directory -Path (Join-Path $TmpDir "bin") -Force | Out-Null
            foreach ($b in $BinNames) {
                $src = Join-Path "target\release" $b
                if (Test-Path $src) { Copy-Item $src (Join-Path $TmpDir "bin\") }
            }
            if ((Test-Path "web-ui") -and (Get-Command npm -ErrorAction SilentlyContinue)) {
                Log "Building web UI..."
                Push-Location web-ui
                npm ci --silent; npm run build
                Pop-Location
                Copy-Item "web-ui\dist" (Join-Path $TmpDir "web-ui-dist") -Recurse
            } elseif (Test-Path "web-ui") {
                Warn "npm not found - skipping web UI build."
            }
        } finally { Pop-Location }
        $BinDir = Join-Path $TmpDir "bin"
        $WebDist = Join-Path $TmpDir "web-ui-dist"
    } else {
        if (Test-Path (Join-Path $TmpDir "bin")) { $BinDir = Join-Path $TmpDir "bin" } else { $BinDir = $TmpDir }
        $WebDist = $null
    }

    foreach ($b in $BinNames) {
        if (-not (Test-Path (Join-Path $BinDir $b))) { Warn "Binary not found: $b (will be skipped)" }
    }

    # ------------------------------------------------------------ install ----
    Log "Installing to $BckHome ..."
    New-Item -ItemType Directory -Path (Join-Path $BckHome "bin") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $BckDataDir "config") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $BckDataDir "backups") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $BckDataDir "tmp") -Force | Out-Null

    foreach ($b in $BinNames) {
        $src = Join-Path $BinDir $b
        if (Test-Path $src) { Copy-Item $src (Join-Path $BckHome "bin\") -Force }
    }

    # Web UI
    $UiCandidates = @()
    if ($WebDist -and (Test-Path $WebDist)) { $UiCandidates += $WebDist }
    $releaseUi = Join-Path $TmpDir "web-ui"
    if (Test-Path $releaseUi) { $UiCandidates += $releaseUi }
    foreach ($ui in $UiCandidates) {
        if (Test-Path (Join-Path $ui "dist") ) {
            Copy-Item (Join-Path $ui "dist") (Join-Path $BckHome "web-ui\dist") -Recurse -Force
            break
        }
    }

    # Config (preserve existing on update)
    $Config = Join-Path $BckDataDir "config\config.toml"
    if (-not (Test-Path $Config)) {
        $homeWin    = $BckHome
        $dataFwd    = $BckDataDir.Replace('\', '/')
        $backupsWin = (Join-Path $BckDataDir "backups")
        $tmpWin     = (Join-Path $BckDataDir "tmp")
        @"
[server]
host = "0.0.0.0"
port = $BckPort
grpc_port = 9441
web_ui_dir = "$homeWin\web-ui\dist"

[database]
url = "sqlite://$dataFwd/bck.db?mode=rwc"
pool_size = 10
migrate = true

[storage]
default_path = "$backupsWin"
temp_path = "$tmpWin"

[encryption]
algorithm = "aes-256-gcm"

[logging]
level = "info"
json = false
"@ | Set-Content -Path $Config -Encoding UTF8
        Log "Created default config at $Config"
    } else {
        Log "Config exists - preserving it."
    }

    # Add binaries to machine PATH
    $binPath = Join-Path $BckHome "bin"
    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    if (($machinePath -split ";") -notcontains $binPath) {
        [Environment]::SetEnvironmentVariable("PATH", "$machinePath;$binPath", "Machine")
        $env:PATH = "$env:PATH;$binPath"
        Log "Added $binPath to machine PATH."
    }

    # ------------------------------------------------------------ service ----
    $svc = Get-Service -Name "bckd" -ErrorAction SilentlyContinue
    $exe = Join-Path $BckHome "bin\bckd.exe"
    if ($svc) {
        Log "Updating existing service 'bckd'..."
        Stop-Service -Name "bckd" -Force -ErrorAction SilentlyContinue
        sc.exe config bckd binPath= "`"$exe`" -c `"$Config`"" start= auto | Out-Null
    } else {
        Log "Registering Windows service 'bckd'..."
        New-Service -Name "bckd" -DisplayName "BCK Enterprise Backup Daemon" `
            -BinaryPathName "`"$exe`" -c `"$Config`"" `
            -StartupType Automatic -Description "Backup & Disaster Recovery daemon" | Out-Null
        # Restart on failure, after 5s (sc failure only works on an existing service).
        sc.exe failure bckd reset= 86400 actions= restart/5000 | Out-Null
    }
    Start-Service -Name "bckd" -ErrorAction SilentlyContinue
    Log "Service 'bckd' registered. Status: Get-Service bckd"

    # Bootstrap admin password (fresh installs only)
    $BootstrapFile = Join-Path $BckDataDir "bootstrap_admin.txt"
    if (-not (Test-Path $BootstrapFile)) {
        for ($i = 0; $i -lt 40; $i++) {
            if (Test-Path $BootstrapFile) { break }
            Start-Sleep -Milliseconds 500
        }
    }
    if (Test-Path $BootstrapFile) {
        $bootLine = (Get-Content $BootstrapFile | Where-Object { $_ -like "password:*" } | Select-Object -First 1)
        if ($bootLine) {
            Log "Bootstrap admin: username=admin $($bootLine.Trim())"
            Log "Change this password immediately after first login."
        }
    } else {
        Log "No bootstrap admin password found (already initialized?). Check: $BckDataDir"
    }

    # ------------------------------------------------------------ finalize ---
    Log "==============================================="
    Log " BCK Enterprise Backup installed/updated"
    Log "   Home:    $BckHome"
    Log "   Config:  $Config"
    Log "   Data:    $BckDataDir"
    Log "   Web UI:  http://localhost:$BckPort"
    Log "   Service: Get-Service bckd / Restart-Service bckd"
    Log "   CLI:     bck --help"
    Log "   Agent:   bck-agent --server <host> --port 9440"
    Log "==============================================="
    Log "Re-run this installer any time to update."
} finally {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}
