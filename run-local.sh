#!/bin/bash

echo "============================================"
echo "   BCK Backup System — Universal Launcher"
echo "============================================"
echo ""

# ─── Check Node.js ──────────────────────────────
if ! command -v node &> /dev/null; then
    echo "[*] Node.js not found. Installing..."
    if command -v apt &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v brew &> /dev/null; then
        brew install node@20
    else
        echo "[!] Please install Node.js 20+ manually: https://nodejs.org"
        exit 1
    fi
    echo "[v] Node.js installed"
else
    echo "[v] Node.js detected: $(node --version)"
fi

# ─── Install root dependencies ──────────────────
if [ ! -d "node_modules" ]; then
    echo "[*] Installing server dependencies..."
    npm install
else
    echo "[v] Server dependencies OK"
fi

# ─── Install frontend dependencies ──────────────
if [ ! -d "frontend/node_modules" ]; then
    echo "[*] Installing frontend dependencies..."
    cd frontend && npm install && cd ..
else
    echo "[v] Frontend dependencies OK"
fi

# ─── Build frontend if needed ───────────────────
if [ ! -f "frontend/build/index.html" ]; then
    echo "[*] Building frontend..."
    cd frontend && npm run build && cd ..
    echo "[v] Frontend built"
else
    echo "[v] Frontend build OK"
fi

# ─── Start server ───────────────────────────────
echo ""
echo "============================================"
echo "   Starting server..."
echo "   Open: http://localhost:6000"
echo "   Login: admin / 291263"
echo "============================================"
node server.js
