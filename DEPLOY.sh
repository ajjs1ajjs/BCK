#!/bin/bash
set -e

echo "=== BCK Deployment ==="

if ! command -v node &> /dev/null; then
  echo "Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Installing dependencies..."
npm install

echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Ensure all service files exist
for f in services/database.js services/cloud.js services/host.js services/vm.js services/exec.js; do
  if [ ! -f "$f" ]; then
    echo "ERROR: Missing $f — deploy all files from the repo"
    exit 1
  fi
done

echo "=== Deployment complete! ==="
echo "Run: node server.js"
echo "Then open http://localhost:6000"
