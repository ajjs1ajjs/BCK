#!/bin/bash
set -e

echo "=== BCK Deployment ==="

# Install Node.js if missing
if ! command -v node &> /dev/null; then
  echo "Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Install frontend dependencies and build
echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Create db.json if not exists
if [ ! -f db.json ]; then
  echo '{"backups":[],"schedules":[],"logs":[],"stats":{"totalBackups":0,"successfulBackups":0,"failedBackups":0,"lastBackup":null}}' > db.json
fi

echo ""
echo "=== Deployment complete! ==="
echo "Run: node server.js"
echo "Then open http://localhost:6000"
