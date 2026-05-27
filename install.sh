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

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bck.service
sudo systemctl start bck.service

# ─── Done ─────────────────────────────────────────
IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       Installation Complete! 🎉          ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}URL:${NC}      http://$IP:3000"
echo -e "  ${CYAN}Login:${NC}    admin"
echo -e "  ${CYAN}Password:${NC} 291263"
echo ""
echo -e "  ${BOLD}Commands:${NC}"
echo -e "  sudo systemctl status bck    — check status"
echo -e "  sudo systemctl restart bck   — restart"
echo -e "  sudo journalctl -u bck -f    — live logs"
echo ""
