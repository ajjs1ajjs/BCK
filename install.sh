#!/bin/bash
set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "${CYAN}${BOLD}"
echo "╔═══════════════════════════════════════════╗"
echo "║        BCK Backup System Installer        ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

REPO_URL="https://github.com/ajjs1ajjs/BCK.git"
INSTALL_DIR="/opt/bck"

# ─── Check / Install Node.js ──────────────────────
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}[*] Node.js not found. Installing...${NC}"
    if command -v apt &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo dnf install -y nodejs
    elif command -v yum &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo yum install -y nodejs
    elif command -v apk &> /dev/null; then
        apk add nodejs npm
    else
        echo -e "${RED}[!] Could not install Node.js. Install manually: https://nodejs.org${NC}"
        exit 1
    fi
    echo -e "${GREEN}[v] Node.js installed: $(node --version)${NC}"
else
    echo -e "${GREEN}[v] Node.js: $(node --version)${NC}"
fi

if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "${YELLOW}[*] Updating via git pull...${NC}"
    cd "$INSTALL_DIR"
    git checkout -- package-lock.json frontend/package-lock.json 2>/dev/null || true
    git pull
elif [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/server.js" ]; then
    echo -e "${YELLOW}[*] Updating existing installation (no git)...${NC}"
    cd "$INSTALL_DIR"
    # Init git and pull latest to ensure all files are present
    if command -v git &> /dev/null; then
        git init
        git remote add origin "$REPO_URL"
        git fetch origin
        git reset origin/main --hard
    fi
elif [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}[*] Directory exists but empty. Removing...${NC}"
    sudo rm -rf "$INSTALL_DIR"
fi

if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}[*] Cloning repository...${NC}"
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$(whoami)" "$INSTALL_DIR"
    if command -v git &> /dev/null; then
        git clone "$REPO_URL" "$INSTALL_DIR"
    else
        echo -e "${RED}[!] git not found. Install git or clone manually.${NC}"
        exit 1
    fi
    cd "$INSTALL_DIR"
fi

# ─── Verify all service files exist ───────────────
MISSING=""
for f in services/database.js services/cloud.js services/host.js services/vm.js services/exec.js; do
    if [ ! -f "$INSTALL_DIR/$f" ]; then
        MISSING="$MISSING $f"
    fi
done
if [ -n "$MISSING" ]; then
    echo -e "${RED}[!] Missing files:$MISSING. Run git pull or re-clone.${NC}"
    exit 1
fi

# ─── Install CLI tools ────────────────────────────
set +e
echo -e "${YELLOW}[*] Installing CLI tools for backups...${NC}"

PKG=""
if command -v apt &>/dev/null; then
  PKG="apt"
elif command -v dnf &>/dev/null; then
  PKG="dnf"
elif command -v yum &>/dev/null; then
  PKG="yum"
elif command -v apk &>/dev/null; then
  PKG="apk"
fi

install_pkg() {
  local name="$1"; local pkg_name="$2"
  if command -v "$name" &>/dev/null; then
    echo -e "  ${GREEN}[v] $name — already installed${NC}"
    return 0
  fi
  echo -e "  ${YELLOW}[*] Installing $name...${NC}"
  case "$PKG" in
    apt) sudo apt-get install -y "$pkg_name" ;;
    dnf) sudo dnf install -y "$pkg_name" ;;
    yum) sudo yum install -y "$pkg_name" ;;
    apk) sudo apk add "$pkg_name" ;;
  esac 2>/dev/null
  if command -v "$name" &>/dev/null; then
    echo -e "  ${GREEN}[v] $name — installed${NC}"
  else
    echo -e "  ${RED}[!] $name — failed to install${NC}"
  fi
}

# Database CLI tools
install_pkg "mysqldump" "mysql-client"
install_pkg "pg_dump" "postgresql-client"

# AWS CLI
if ! command -v aws &>/dev/null; then
  echo -e "  ${YELLOW}[*] Installing AWS CLI...${NC}"
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip 2>/dev/null && \
    unzip -q /tmp/awscliv2.zip -d /tmp/ && sudo /tmp/aws/install --update 2>/dev/null && \
    rm -rf /tmp/aws /tmp/awscliv2.zip
  command -v aws &>/dev/null && echo -e "  ${GREEN}[v] AWS CLI — installed${NC}" || echo -e "  ${RED}[!] AWS CLI — failed${NC}"
fi

# Azure CLI
if ! command -v az &>/dev/null; then
  echo -e "  ${YELLOW}[*] Installing Azure CLI...${NC}"
  curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash 2>/dev/null
  command -v az &>/dev/null && echo -e "  ${GREEN}[v] Azure CLI — installed${NC}" || echo -e "  ${RED}[!] Azure CLI — failed${NC}"
fi

# gsutil (Google Cloud SDK)
if ! command -v gsutil &>/dev/null; then
  echo -e "  ${YELLOW}[*] Installing Google Cloud SDK (gsutil)...${NC}"
  curl -fsSL https://sdk.cloud.google.com | CLOUDSDK_CORE_DISABLE_PROMPTS=1 bash 2>/dev/null
  if [ -f "$HOME/google-cloud-sdk/bin/gsutil" ]; then
    export PATH="$HOME/google-cloud-sdk/bin:$PATH"
    echo 'export PATH="$HOME/google-cloud-sdk/bin:$PATH"' >> "$HOME/.bashrc"
    echo -e "  ${GREEN}[v] gsutil — installed${NC}"
  else
    echo -e "  ${RED}[!] gsutil — failed to install${NC}"
  fi
fi

# govc (VMware vSphere CLI)
if ! command -v govc &>/dev/null; then
  echo -e "  ${YELLOW}[*] Installing govc (VMware)...${NC}"
  GOVC_VER=$(curl -sL https://api.github.com/repos/vmware/govmomi/releases/latest 2>/dev/null | grep tag_name | cut -d'"' -f4)
  if [ -n "$GOVC_VER" ]; then
    curl -sL "https://github.com/vmware/govmomi/releases/download/${GOVC_VER}/govc_$(uname -s)_$(uname -m).tar.gz" 2>/dev/null | sudo tar -C /usr/local/bin -xz govc 2>/dev/null
  fi
  command -v govc &>/dev/null && echo -e "  ${GREEN}[v] govc — installed${NC}" || echo -e "  ${RED}[!] govc — failed${NC}"
fi

echo ""
echo -e "  ${CYAN}Note:${NC} PowerShell for Hyper-V is available only on Windows hosts."
echo -e "  ${CYAN}      Oracle expdp/impdp — install Oracle Instant Client manually.${NC}"
echo ""
set -e

# ─── Install dependencies ─────────────────────────
echo -e "${YELLOW}[*] Installing server dependencies...${NC}"
npm install

echo -e "${YELLOW}[*] Installing frontend dependencies...${NC}"
cd frontend && npm install && cd ..

# ─── Build frontend ───────────────────────────────
echo -e "${YELLOW}[*] Building frontend...${NC}"
cd frontend && npm run build && cd ..

# ─── Setup .env ───────────────────────────────────
get_local_ip() {
    local ip_addr=""
    if command -v hostname >/dev/null 2>&1; then
        ip_addr=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | head -n1)
    fi
    if [ -z "$ip_addr" ] && command -v ip >/dev/null 2>&1; then
        ip_addr=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i=="src") {print $(i+1); exit}}')
    fi
    echo "${ip_addr:-127.0.0.1}"
}

LOCAL_IP=$(get_local_ip)
APP_URL="${BCK_APP_URL:-http://$LOCAL_IP:9000}"

if [ -f .env ]; then
    for var in APP_URL HOST; do
        if ! grep -q "^$var=" .env; then
            [ "$var" = "HOST" ] && echo "HOST=0.0.0.0" >> .env || echo "APP_URL=$APP_URL" >> .env
        fi
    done
    sed -i "s|^APP_URL=.*|APP_URL=$APP_URL|" .env
else
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || echo "bck-super-secret-change-in-production-2024")
    cat > .env <<EOF
PORT=9000
JWT_SECRET=$JWT_SECRET
DB_PATH=./db.json
NODE_ENV=production
HOST=0.0.0.0
APP_URL=$APP_URL
EOF
fi

# ─── Setup systemd service ────────────────────────
echo -e "${YELLOW}[*] Creating systemd service...${NC}"
sudo tee /etc/systemd/system/bck.service > /dev/null <<EOF
[Unit]
Description=BCK Backup System
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=-$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bck.service
sudo systemctl restart bck.service

# ─── Done ─────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       Installation Complete!              ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}URL:${NC}      $APP_URL"
echo -e "  ${CYAN}Login:${NC}    admin"
echo ""
echo -e "  ${BOLD}Commands:${NC}"
echo -e "  sudo systemctl status bck    — check status"
echo -e "  sudo systemctl restart bck   — restart"
echo -e "  sudo journalctl -u bck -f    — live logs"
echo ""
