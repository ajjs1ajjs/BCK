# BCK Backup System

Modern web-based backup management system with scheduling, monitoring, and multi-source support.

## Features

- **Backup Management** — Create, run, and monitor database, VM, and cloud backups
- **Scheduling** — Cron-based automated backup schedules
- **Restore** — One-click restore from any backup point
- **Multi-Source** — Database (MySQL, PostgreSQL, MongoDB), VM, and Cloud (S3, GCS, Azure) support
- **Dashboard** — Real-time charts, storage gauges, activity timeline, and performance metrics
- **User Management** — Role-based access control with custom permissions
- **Activity Log** — Full audit trail of all system actions
- **Retention Policies** — Automated cleanup with configurable retention rules
- **Dark/Light Theme** — Modern glassmorphism UI with dark mode

## Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18, MUI 5, Recharts |
| Backend | Node.js, Express |
| Database | JSON file store (`db.json`) |
| Build | Create React App |

## Quick Start

### One-command launch

```bash
# Windows:
run-local.bat

# Linux / macOS:
chmod +x run-local.sh && ./run-local.sh
```

The script will:
1. Auto-detect Node.js (download & install if missing)
2. Install all dependencies
3. Build the frontend
4. Start the server

Then open **http://localhost:3000**

### Manual setup

```bash
# 1. Install backend dependencies
npm install

# 2. Install frontend dependencies
cd frontend && npm install && cd ..

# 3. Build frontend for production
cd frontend && npm run build && cd ..

# 4. Start server (serves API + built frontend)
node server.js

# Or development mode (hot reload):
cd frontend && npm start
```

## Default Credentials

| User | Password | Role |
|------|----------|------|
| admin | 291263 | Admin (full access) |
| operator | operator | Operator (manage backups) |
| viewer | viewer | Viewer (read-only) |

## Commands

```bash
# Build frontend for production
cd frontend && npm run build

# Start production server
node server.js

# Development server (frontend on :3000, API on :3000)
cd frontend && npm start

# Reset database
# Delete db.json and restart server
```

## Project Structure

```
BCK/
├── server.js              # Express API server
├── services/              # Core services
│   ├── database.js        # Database backup service
│   ├── vm.js              # VM backup service
│   └── cloud.js           # Cloud backup service
├── frontend/              # React SPA
│   └── src/
│       ├── pages/         # Route pages
│       ├── components/    # Reusable components
│       ├── context/       # Auth context
│       └── theme.js       # MUI theme
└── db.json               # Auto-generated data store
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/login | Authenticate user |
| GET/POST | /api/backups | List / Create backups |
| PUT/DELETE | /api/backups/:id | Update / Delete backup |
| POST | /api/backups/:id/run | Execute backup |
| GET | /api/schedules | List schedules |
| GET/POST/DELETE | /api/users | Manage users |
| GET/POST/DELETE | /api/roles | Manage roles |
| GET | /api/logs | View activity logs |
| GET/PUT | /api/settings | System settings |

## License

MIT
