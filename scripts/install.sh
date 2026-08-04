#!/usr/bin/env bash
#
# BCK Enterprise Backup — one-line installer (Linux / macOS)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/BCK/main/scripts/install.sh | bash
#
# Re-running the same command performs an UPDATE (binaries + web UI are
# replaced, configuration and backup data are preserved).
#
# Behavior:
#   1. Download the latest release archive from GitHub Releases.
#      If no release exists yet (or --from-source is passed), build from source.
#   2. Install binaries, web UI and default config to BCK_HOME (/opt/bck).
#   3. Create systemd service (Linux) / launchd plist (macOS).
#   4. Idempotent: safe to re-run, acts as an upgrade.

set -euo pipefail

# ---------------------------------------------------------------- settings ---
REPO="ajjs1ajjs/BCK"
BCK_HOME="${BCK_HOME:-/opt/bck}"
BCK_USER="${BCK_USER:-bck}"
BCK_GROUP="${BCK_GROUP:-bck}"
BCK_DATA_DIR="${BCK_DATA_DIR:-/var/lib/bck}"
BCK_CONFIG_DIR="${BCK_CONFIG_DIR:-/etc/bck}"
BCK_PORT="${BCK_PORT:-9440}"
BCK_VERSION="${BCK_VERSION:-}"            # empty = latest release
MODE="release"                            # release | source

for arg in "$@"; do
    case "$arg" in
        --from-source) MODE="source" ;;
        *) ;;
    esac
done

log()  { printf '\033[1;34m[BCK]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[BCK]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[BCK]\033[0m %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
    Linux)  OS_LOWER="linux" ;;
    Darwin) OS_LOWER="darwin" ;;
    *)      fail "Unsupported OS: $OS" ;;
esac
case "$ARCH" in
    x86_64|amd64) ARCH_LOWER="x86_64" ;;
    aarch64|arm64) ARCH_LOWER="aarch64" ;;
    *) fail "Unsupported arch: $ARCH" ;;
esac

# ------------------------------------------------------------------ helpers ---
require() {
    command -v "$1" >/dev/null 2>&1 || fail "Required tool not found: $1"
}

download() { # url -> local path
    local url="$1" out="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --connect-timeout 20 --retry 3 "$url" -o "$out"
    elif command -v wget >/dev/null 2>&1; then
        wget -q --timeout=20 --tries=3 "$url" -O "$out"
    else
        fail "Need curl or wget"
    fi
}

get_latest_release() {
    local api="https://api.github.com/repos/${REPO}/releases/latest"
    local tag
    tag="$(curl -fsSL "$api" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)" \
        || tag=""
    [ -n "$tag" ] && echo "$tag" || echo ""
}

# --------------------------------------------------------------- download -----
BIN_NAMES=(bckd bck-agent bck-cli bck-proxy)
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

if [ "$MODE" = "release" ]; then
    TAG="${BCK_VERSION:-$(get_latest_release)}"
    if [ -n "$TAG" ]; then
        log "Downloading release $TAG ($OS_LOWER/$ARCH_LOWER)"
        ARCHIVE="bck-${OS_LOWER}-${ARCH_LOWER}.tar.gz"
        URL="https://github.com/${REPO}/releases/download/${TAG}/${ARCHIVE}"
        download "$URL" "$TMPDIR/$ARCHIVE"
        tar -xzf "$TMPDIR/$ARCHIVE" -C "$TMPDIR"
        SRC_DIR="$TMPDIR"
        log "Release binaries staged."
    else
        warn "No GitHub release found; building from source instead."
        MODE="source"
    fi
fi

if [ "$MODE" = "source" ]; then
    log "Building from source (this requires Rust + a C toolchain)..."
    require cargo
    require git
    [ -d "$TMPDIR/BCK" ] || git clone --depth 1 "https://github.com/${REPO}.git" "$TMPDIR/BCK"
    cd "$TMPDIR/BCK"
    cargo build --release --workspace --bins 2>&1 | tail -n 5
    SRC_DIR="$TMPDIR/BCK"
    # Collect binaries
    mkdir -p "$TMPDIR/bin"
    for b in "${BIN_NAMES[@]}"; do
        [ -f "target/release/$b" ] && cp "target/release/$b" "$TMPDIR/bin/" || warn "missing binary: $b"
    done
    # Build web UI if node is available
    if [ -d web-ui ] && command -v npm >/dev/null 2>&1; then
        log "Building web UI..."
        (cd web-ui && npm ci --silent && npm run build)
        mkdir -p "$TMPDIR/web-ui"
        cp -r web-ui/dist "$TMPDIR/web-ui/"
    fi
fi

# Verify binaries exist in SRC_DIR (either release archive or source build).
if [ "$MODE" = "release" ]; then
    # Release archives contain bin/ at the top level.
    if [ -d "$SRC_DIR/bin" ]; then
        BIN_DIR="$SRC_DIR/bin"
    else
        BIN_DIR="$SRC_DIR"
    fi
else
    BIN_DIR="$TMPDIR/bin"
fi
for b in "${BIN_NAMES[@]}"; do
    [ -f "$BIN_DIR/$b" ] || warn "Binary not found: $b (will be skipped)"
done

# ------------------------------------------------------------- install ---------
log "Installing to $BCK_HOME ..."
if [ "$(id -u)" -eq 0 ]; then
    if ! id -u "$BCK_USER" >/dev/null 2>&1; then
        useradd --system --home-dir "$BCK_HOME" --shell /sbin/nologin "$BCK_USER" 2>/dev/null \
            || warn "Could not create system user (continuing with root)"
    fi
fi

mkdir -p "$BCK_HOME/bin"
mkdir -p "$BCK_CONFIG_DIR"
mkdir -p "$BCK_DATA_DIR"
install -m 0755 "$BIN_DIR"/bckd     "$BCK_HOME/bin/" 2>/dev/null || true
install -m 0755 "$BIN_DIR"/bck-agent "$BCK_HOME/bin/" 2>/dev/null || true
install -m 0755 "$BIN_DIR"/bck-cli   "$BCK_HOME/bin/" 2>/dev/null || true
install -m 0755 "$BIN_DIR"/bck-proxy "$BCK_HOME/bin/" 2>/dev/null || true

# Web UI
if [ -d "$SRC_DIR/web-ui" ]; then
    mkdir -p "$BCK_HOME/web-ui"
    cp -r "$SRC_DIR/web-ui/." "$BCK_HOME/web-ui/"
elif [ -d "$TMPDIR/web-ui" ]; then
    mkdir -p "$BCK_HOME/web-ui"
    cp -r "$TMPDIR/web-ui/." "$BCK_HOME/web-ui/"
fi

# Config (preserve existing on update)
CONFIG="$BCK_CONFIG_DIR/config.toml"
if [ ! -f "$CONFIG" ]; then
    cat > "$CONFIG" <<EOF
[server]
host = "0.0.0.0"
port = ${BCK_PORT}
grpc_port = 9441
web_ui_dir = "${BCK_HOME}/web-ui/dist"

[database]
url = "sqlite://${BCK_DATA_DIR}/bck.db?mode=rwc"
pool_size = 10
migrate = true

[storage]
default_path = "${BCK_DATA_DIR}/backups"
temp_path = "${BCK_DATA_DIR}/tmp"

[encryption]
algorithm = "aes-256-gcm"

[logging]
level = "info"
json = false
EOF
    log "Created default config at $CONFIG"
else
    log "Config exists — preserving it."
fi

# Symlink binaries into PATH
mkdir -p /usr/local/bin
for b in "${BIN_NAMES[@]}"; do
    [ -f "$BCK_HOME/bin/$b" ] && ln -sf "$BCK_HOME/bin/$b" "/usr/local/bin/$b"
done

# Ownership (ignore failures on non-root / weird mounts)
chown -R "$BCK_USER:$BCK_GROUP" "$BCK_HOME" "$BCK_DATA_DIR" "$BCK_CONFIG_DIR" 2>/dev/null || true

# ------------------------------------------------------------- service ---------
if [ "$OS_LOWER" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
    cat > /etc/systemd/system/bckd.service <<EOF
[Unit]
Description=BCK Enterprise Backup Daemon
After=network.target

[Service]
Type=simple
User=${BCK_USER}
ExecStart=${BCK_HOME}/bin/bckd -c ${BCK_CONFIG_DIR}/config.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload 2>/dev/null || true
    systemctl enable bckd 2>/dev/null || true
    systemctl restart bckd 2>/dev/null || true
    log "systemd service 'bckd' started. Status: systemctl status bckd"
elif [ "$OS_LOWER" = "darwin" ]; then
    PLIST="$HOME/Library/LaunchAgents/com.bck.daemon.plist"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>Label</key><string>com.bck.daemon</string>
    <key>ProgramArguments</key>
    <array><string>${BCK_HOME}/bin/bckd</string><string>-c</string><string>${CONFIG}</string></array>
    <key>KeepAlive</key><true/>
</dict></plist>
EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST" 2>/dev/null || true
    log "launchd agent installed. Status: launchctl list | grep com.bck.daemon"
else
    warn "No service manager detected — run the daemon manually:"
    warn "  ${BCK_HOME}/bin/bckd -c ${CONFIG}"
fi

# ------------------------------------------------------------- finalize ---------
VER="$(grep '^version' "$BCK_HOME" 2>/dev/null || echo installed)"
log "==============================================="
log " BCK Enterprise Backup installed/updated"
log "   Home:    $BCK_HOME"
log "   Config:  $CONFIG"
log "   Data:    $BCK_DATA_DIR"
log "   Web UI:  http://localhost:${BCK_PORT}  (default login admin/admin)"
log "   Binaries: ${BCK_HOME}/bin/{bckd,bck-agent,bck-cli,bck-proxy}"
log "   CLI:     bck-cli --help"
log "   Agent:   bck-agent --server <host> --port 9440"
log "==============================================="
log "Re-run this installer any time to update."
