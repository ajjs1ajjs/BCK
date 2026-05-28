# Deployment Guide

## Prerequisites

### For Linux (Ubuntu/Debian/CentOS):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### For Windows:
Download and install Node.js 20+ from https://nodejs.org/

## Quick Deploy

### Linux
```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/BCK/master/install.sh | sudo bash
```

### Windows
```batch
git clone https://github.com/ajjs1ajjs/BCK.git
cd BCK
.\install.bat
```

### Docker
```bash
docker compose up -d
```

## Manual Setup

```bash
git clone <repo-url>
cd BCK
npm install
cd frontend && npm install && npm run build && cd ..
node server.js
```

Open **http://localhost:9000**

## Environment Variables

Create a `.env` file in the project root:

```
PORT=9000
JWT_SECRET=<generate-a-random-secret>
DB_PATH=./db.json
NODE_ENV=production
HOST=0.0.0.0
APP_URL=http://your-ip:9000
# Optional: HTTPS
# SSL_CERT_PATH=./cert.pem
# SSL_KEY_PATH=./key.pem
```

## Systemd Service (Linux)

```ini
[Unit]
Description=BCK Backup System
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/BCK
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable bck
sudo systemctl start bck
```

## Docker Build

```bash
docker build -t bck-app .
docker run -p 9000:9000 bck-app
```

## Firewall

```bash
sudo ufw allow 9000/tcp
```

## Troubleshooting

- **Port in use**: `lsof -i :9000` (Linux) or `netstat -ano | findstr :9000` (Windows)
- **Permission denied**: `sudo chown -R $USER:$USER .`
