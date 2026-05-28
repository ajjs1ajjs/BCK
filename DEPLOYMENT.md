# Deployment Guide

## Prerequisites

### For Linux (Ubuntu/Debian/CentOS):
```bash
# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build tools
sudo apt-get install -y build-essential
```

### For Windows:
1. Download and install Node.js from https://nodejs.org/
2. Install Python 3 and add it to PATH
3. Install Microsoft C++ Build Tools from Visual Studio Installer

## Deployment Steps

### 1. Clone the Repository
```bash
git clone <repository-url>
cd BCK
```

### 2. Install Dependencies
```bash
# For Linux:
npm install

# For Windows (if needed):
npm install --platform=win32
```

### 3. Build for Production
```bash
npm run build
```

### 4. Run the Application
#### Development Mode:
```bash
npm start
```

#### Production Mode:
```bash
# Using serve package
npm install -g serve
serve -s build

# Or using http-server
npm install -g http-server
http-server build
```

## Environment Variables

Create a `.env` file in the project root with:
```
REACT_APP_API_URL=http://localhost:6000
```

## Systemd Service (Linux)

To run as a background service on Linux:

1. Create systemd service file:
```bash
sudo nano /etc/systemd/system/bck.service
```

2. Add the following content:
```ini
[Unit]
Description=Backup Solution
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

3. Enable and start the service:
```bash
sudo systemctl enable bck
sudo systemctl start bck
```

## Windows Service (Alternative)

Use NSSM (Non-Sucking Service Manager) to create a Windows service:
1. Download NSSM from https://nssm.cc/
2. Run `nssm install BCK` and configure the application path

## Docker Deployment (Optional)

To build and run with Docker:
```bash
docker build -t bck-app .
docker run -p 6000:6000 bck-app
```

Dockerfile:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 6000
CMD ["npm", "start"]
```

## Firewall Configuration (Linux)

If running on a server, ensure ports are open:
```bash
# For Ubuntu/Debian:
sudo ufw allow 6000/tcp

# For CentOS/RHEL:
sudo firewall-cmd --permanent --add-port=6000/tcp
sudo firewall-cmd --reload
```

## Monitoring and Logging

### Linux:
```bash
# Monitor logs
tail -f /var/log/bck.log

# Using journalctl
journalctl -u bck.service -f
```

### Windows:
Use Event Viewer or PowerShell logging.

## Troubleshooting

1. **Port in use**: Check for processes using the port:
   ```bash
   # Linux
   lsof -i :6000
   kill -9 [PID]
   
   # Windows
   netstat -ano | findstr :6000
   taskkill /PID [PID] /F
   ```

2. **Permission denied**: Ensure proper file permissions:
   ```bash
   sudo chown -R $USER:$USER .
   chmod -R 755 .
   ```