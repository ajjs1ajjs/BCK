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

# ─── Clone / Update repo ──────────────────────────
INSTALL_DIR="/opt/bck"
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}[*] Updating existing installation...${NC}"
    cd "$INSTALL_DIR"
    git pull
else
    echo -e "${YELLOW}[*] Cloning repository...${NC}"
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$(whoami)" "$INSTALL_DIR"
    git clone https://github.com/ajjs1ajjs/BCK.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ─── Install dependencies ─────────────────────────
echo -e "${YELLOW}[*] Installing server dependencies...${NC}"
npm install

echo -e "${YELLOW}[*] Installing frontend dependencies...${NC}"
cd frontend && npm install && cd ..

# ─── Build frontend ───────────────────────────────
echo -e "${YELLOW}[*] Building frontend...${NC}"
cd frontend && npm run build && cd ..

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
APP_URL="${BCK_APP_URL:-http://$LOCAL_IP:6000}"

if [ -f .env ]; then
    if grep -q '^APP_URL=' .env; then
        sed -i "s|^APP_URL=.*|APP_URL=$APP_URL|" .env
    else
        echo "APP_URL=$APP_URL" >> .env
    fi
    if grep -q '^HOST=' .env; then
        sed -i "s|^HOST=.*|HOST=0.0.0.0|" .env
    else
        echo "HOST=0.0.0.0" >> .env
    fi
else
    cat > .env <<EOF
PORT=6000
JWT_SECRET=bck-super-secret-change-in-production-2024
DB_PATH=./db.json
NODE_ENV=production
HOST=0.0.0.0
APP_URL=$APP_URL
EOF
fi

# ─── Create systemd service ───────────────────────
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
sudo systemctl start bck.service

# ─── Done ─────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       Installation Complete! 🎉          ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}URL:${NC}      $APP_URL"
echo -e "  ${CYAN}Login:${NC}    admin"
echo -e "  ${CYAN}Password:${NC} 291263"
echo ""
echo -e "  ${BOLD}Commands:${NC}"
echo -e "  sudo systemctl status bck    — check status"
echo -e "  sudo systemctl restart bck   — restart"
echo -e "  sudo journalctl -u bck -f    — live logs"
echo ""
