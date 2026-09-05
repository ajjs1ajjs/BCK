<#
.SYNOPSIS
    BCK Enterprise Backup - one-line installer for Windows (PowerShell).

.DESCRIPTION
    Mirrors scripts/install.sh for Ubuntu/Debian. Fully automatic:

      irm https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.ps1 | iex

    Or locally:
      powershell -ExecutionPolicy Bypass -File scripts\install.ps1
      powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -FromSource
      powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Version v0.7.0

    Anything that is missing is downloaded and installed automatically:
    release archive -> binaries; otherwise build tools (Rust, Git, protoc,
    Node.js, MSVC Build Tools) via rustup / winget / direct download.

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
$BckHome    = if ($env:BCK_HOME)     { $env:BCK_HOME }     else { Join-Path $env:ProgramFiles "BCK" }
$BckDataDir = if ($env:BCK_DATA_DIR) { $env:BCK_DATA_DIR } else { Join-Path $env:ProgramData "bck" }
$BckPort    = if ($env:BCK_PORT)     { $env:BCK_PORT }     else { "9440" }
$BinNames   = @("bckd.exe", "bck-agent.exe", "bck.exe", "bck-proxy.exe")
$ProtocVer  = "29.3"

function Log  { param($m) Write-Host "[BCK] $m" -ForegroundColor Cyan }
function Warn { param($m) Write-Host "[BCK] $m" -ForegroundColor Yellow }
function Fail { param($m) Write-Host "[BCK] $m" -ForegroundColor Red; exit 1 }

function Check-WindowsVersion {
    $osVersion = [System.Environment]::OSVersion.Version
    $build = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").CurrentBuild
    $buildRevision = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").CurrentBuildRevision

    $supportedBuilds = @{
        "Windows 10 2022" = @(19044, 19045, 20049, 20348, 21313, 21382, 22000, 22336, 22621, 22631, 23466, 23530, 25398)
        "Windows 11 2022" = @(22000, 22621, 22631, 23466, 23530, 25398)
        "Windows Server 2022" = @(20348)
        "Windows Server 2025" = @(25398)
    }

    $isSupported = $false
    $displayName = ""

    if ($osVersion.Major -eq "10" -and $osVersion.Build -ge 19044) {
        if ($osVersion.Build -le 19045) { $displayName = "Windows 10 2022 (21H1/21H2)"; $isSupported = $true }
        elseif ($osVersion.Build -in @(20049, 21313, 21382, 22000)) { $displayName = "Windows 10/11 2022+ (Dev/Beta)"; $isSupported = $true }
        elseif ($osVersion.Build -in @(22336, 22621, 22631, 23466, 23530, 25398)) { $displayName = "Windows 11 2022+"; $isSupported = $true }
    }
    elseif ($osVersion.Major -eq "10" -and $osVersion.Build -ge 20348 -and $osVersion.Build -le 20348) {
        $displayName = "Windows Server 2022"; $isSupported = $true
    }
    elseif ($osVersion.Major -ge "11" -and $osVersion.Build -ge 25398) {
        $displayName = "Windows Server 2025 / Windows 11 2024+"; $isSupported = $true
    }

    if (-not $isSupported) {
        Fail "Unsupported Windows version: $osVersion ($displayName). Supported: Windows 10 21H1/21H2, Windows 11 22H2+, Windows Server 2022/2025."
    }
    Log "Detected $displayName (Build $build) — supported."
}

# Check Windows version early
if ($Env:OS -eq "Windows_NT") {
    Check-WindowsVersion
}

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
function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath    = [Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH = "$machinePath;$userPath"
}

function Invoke-WingetInstall {
    param([string]$Id, [string]$Override = "")
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Warn "winget not available - cannot auto-install $Id."
        return $false
    }
    Log "Installing $Id via winget (this may take a while)..."
    $args = @("install", "--id", $Id, "-e", "--silent",
              "--accept-source-agreements", "--accept-package-agreements")
    if ($Override) { $args += "--override"; $args += $Override }
    & winget @args | Out-Null
    Refresh-Path
    return ($LASTEXITCODE -eq 0)
}

function Get-LatestRelease {
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 20
        return $r.tag_name
    } catch { return "" }
}

# ------------------------------------------------- auto-install build deps ---
function Ensure-Rust {
    if (Get-Command cargo -ErrorAction SilentlyContinue) {
        Log "Rust toolchain present ($(cargo --version))."
        return
    }
    Log "Installing Rust toolchain (rustup)..."
    $rustupInit = Join-Path $env:TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupInit -TimeoutSec 120
    if ((Get-Item $rustupInit).Length -lt 1024) { Fail "rustup-init.exe download failed or too small" }
    & $rustupInit -y --profile minimal | Out-Null
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Fail "Rust installed but 'cargo' not on PATH yet. Open a new shell and re-run."
    }
}

function Ensure-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) { return }
    if (Invoke-WingetInstall -Id "Git.Git") {
        if (Get-Command git -ErrorAction SilentlyContinue) { Log "Git installed."; return }
    }
    Fail "git could not be installed automatically. Install it manually and re-run."
}

function Ensure-Node {
    if (Get-Command npm -ErrorAction SilentlyContinue) { return }
    Warn "npm not found - installing Node.js for the web console..."
    if (-not (Invoke-WingetInstall -Id "OpenJS.NodeJS.LTS")) {
        Warn "Node.js could not be installed automatically - web console will be skipped (daemon/CLI/agent work)."
    }
}

function Ensure-Protoc {
    if (Get-Command protoc -ErrorAction SilentlyContinue) {
        Log "protoc present ($(protoc --version))."
        return
    }
    # Direct download of the official prebuilt binary - no package manager needed.
    $toolsDir = Join-Path $BckDataDir "tools\protoc"
    if (-not (Test-Path (Join-Path $toolsDir "bin\protoc.exe"))) {
        Log "Downloading protoc v$ProtocVer..."
        $zip = Join-Path $env:TEMP "protoc-$ProtocVer-win64.zip"
        Invoke-WebRequest `
            -Uri "https://github.com/protocolbuffers/protobuf/releases/download/v$ProtocVer/protoc-$ProtocVer-win64.zip" `
            -OutFile $zip -TimeoutSec 180
        if ((Get-Item $zip).Length -lt 1024) { Fail "protoc.zip download failed or too small" }
        New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
        try { Expand-Archive $zip -DestinationPath $toolsDir -Force } catch { Fail "protoc.zip integrity check failed: $_" }
        Remove-Item $zip -Force
    }
    $binDir = Join-Path $toolsDir "bin"
    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    if (($machinePath -split ";") -notcontains $binDir) {
        [Environment]::SetEnvironmentVariable("PATH", "$binDir;$machinePath", "Machine")
    }
    [Environment]::SetEnvironmentVariable("PROTOC", (Join-Path $binDir "protoc.exe"), "Machine")
    $env:PATH   = "$binDir;$env:PATH"
    $env:PROTOC = Join-Path $binDir "protoc.exe"
    if (-not (Get-Command protoc -ErrorAction SilentlyContinue)) {
        Fail "protoc was downloaded but is not reachable on PATH. Re-run the installer."
    }
    Log "protoc v$ProtocVer installed to $binDir."
}

function Ensure-Msvc {
    # The MSVC linker ships with Visual Studio Build Tools. Only needed for
    # source builds; detection: cl/link on PATH or an existing VS install.
    $vsRoots = @("$env:ProgramFiles\Microsoft Visual Studio", "${env:ProgramFiles(x86)}\Microsoft Visual Studio")
    foreach ($root in $vsRoots) {
        if (Test-Path $root) { return }
    }
    if ((Get-Command link.exe -ErrorAction SilentlyContinue) -and (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
        return
    }
    Warn "MSVC Build Tools not found - they are required to link Rust programs."
    Warn "Installing Microsoft.VisualStudio.2022.BuildTools (several GB, takes a while)..."
    $override = "--quiet --wait --norestart --nocache " +
                "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    if (-not (Invoke-WingetInstall -Id "Microsoft.VisualStudio.2022.BuildTools" -Override $override)) {
        Fail "MSVC Build Tools could not be installed automatically."
        Warn "Install manually: winget install Microsoft.VisualStudio.2022.BuildTools"
        Warn "Then re-run this installer."
    }
    # New toolchains are added to PATH by vsdevcmd at compile time via cargo;
    # a fresh shell picks them up automatically.
}

function Ensure-BuildDeps {
    Ensure-Rust
    Ensure-Git
    Ensure-Protoc
    Ensure-Node
    Ensure-Msvc
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
                Warn "Release download failed ($Archive); building from source instead."
                $Mode = "source"
            }
        } else {
            Warn "No GitHub release found; building from source instead."
            $Mode = "source"
        }
    }

    $BinDir  = $null
    $WebDist = $null
    if ($Mode -eq "release") {
        if (Test-Path (Join-Path $TmpDir "bin")) { $BinDir = Join-Path $TmpDir "bin" } else { $BinDir = $TmpDir }
        $WebDist = Join-Path $TmpDir "web-ui\dist"
    } else {
        Log "Building from source (all missing tools will be installed automatically)..."
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
                Warn "npm not available - skipping web UI build."
            }
        } finally { Pop-Location }
        $BinDir  = Join-Path $TmpDir "bin"
        $WebDist = Join-Path $TmpDir "web-ui-dist"
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
    if ($WebDist -and (Test-Path $WebDist)) {
        New-Item -ItemType Directory -Path (Join-Path $BckHome "web-ui") -Force | Out-Null
        Copy-Item $WebDist (Join-Path $BckHome "web-ui\dist") -Recurse -Force
    } else {
        Warn "No web UI build found - daemon will run without the console UI."
    }

    # Config (preserve existing on update)
    $Config = Join-Path $BckDataDir "config\config.toml"
    if (-not (Test-Path $Config)) {
        $homeWin    = $BckHome
        $dataFwd    = $BckDataDir.Replace('\', '/')
        $backupsWin = Join-Path $BckDataDir "backups"
        $tmpWin     = Join-Path $BckDataDir "tmp"
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
