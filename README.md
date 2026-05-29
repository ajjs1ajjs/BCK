# BCK Backup System

Enterprise-grade web-based backup management system with scheduling, monitoring, multi-source support, role-based access control, and real-time analytics.

## Features

- **Backup Management** — Create, run, and monitor database, VM, cloud, SSH, and host backups
- **Scheduling** — Cron-based automated backup schedules with `lastRunAt` tracking
- **Restore** — One-click restore from any backup point
- **Multi-Source** — MySQL, PostgreSQL, Oracle, MSSQL, MongoDB, Redis; VMware, Hyper-V; AWS S3, GCS, Azure Blob; SSH remote; Linux/Windows host directories
- **Dashboard Analytics** — Real-time charts (area, pie), storage gauges, activity timeline, backup engine and status distribution
- **Repositories** — Browse all backup files, disk usage meter, download/delete, export CSV/JSON
- **User Management** — Role-based access control with custom per-permission granularity, 2FA (TOTP)
- **Activity Log** — Full audit trail (login, logout, user actions) with IP tracking; pagination & CSV/JSON export
- **Retention Policies** — Automated cleanup by days AND by number of copies
- **Daily Log Rotation** — Cron-based pruning at midnight; configurable retention period
- **Encryption** — AES-256 encrypted credentials and backup files
- **Notifications** — Email (SMTP), Slack, Discord, Telegram, generic Webhook
- **Cloud Diagnostics** — Live connectivity test before saving cloud credentials
- **Dark / Light Theme** — Modern glassmorphism UI with persisted theme preference
- **Error Boundary** — Global React error boundary with reload/retry UI
- **Rate Limiting** — Per-endpoint limits: 5 login attempts / 15 min, 10 backup runs / min, 200 API calls / 15 min

## Stack

| Component | Technology |
|-----------|------------|
| Frontend  | React 18, MUI 5, Recharts |
| Backend   | Node.js 18+, Express 4 |
| Database  | SQLite (via `better-sqlite3`) |
| Scheduling | `node-cron` |
| Security  | `helmet`, `express-rate-limit`, JWT, bcrypt, AES-256 |
| Build     | Create React App |

## Quick Start

### Linux (one-line install)
```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/BCK/master/install.sh | sudo bash
```

### Windows
```batch
git clone https://github.com/ajjs1ajjs/BCK.git
cd BCK
.\install.bat
```

### Or run locally
```bash
# Windows:
run-local.bat

# Linux/macOS:
chmod +x run-local.sh && ./run-local.sh
```

Then open **http://localhost:9000**  
Default credentials: `admin` / `291263` — **change on first login**

## Development

```bash
# Install all dependencies
npm run install:all

# Start backend with auto-reload (nodemon)
npm run dev:backend

# Start frontend dev server (hot-reload on :3000)
npm run dev:frontend

# Run all tests
npm test

# Lint
npm run lint
```

## Project Structure

```
BCK/
├── server.js              # Entry point — Express + Socket.io + HTTPS support
├── services/
│   ├── db.js              # SQLite schema + migrations + indexes
│   ├── database.js        # DB backup/restore service (MySQL, Postgres, etc.)
│   ├── vm.js              # VM backup service (VMware, Hyper-V)
│   ├── cloud.js           # Cloud backup service (S3, GCS, Azure)
│   ├── ssh.js             # SSH remote backup service
│   ├── host.js            # Host directory backup service
│   ├── crypto.js          # AES-256 encryption helpers
│   ├── helpers.js         # addLog, sendNotification, pruneLogs, pruneBackupFiles
│   └── queue.js           # Async backup execution queue
├── routes/
│   ├── auth.js            # Login, logout, 2FA (TOTP)
│   ├── backups.js         # CRUD + run + download + export (CSV/JSON)
│   ├── connections.js     # DB / SSH / Cloud credential management
│   ├── schedules.js       # Cron schedules + lastRunAt + log pruning cron
│   ├── users.js           # User management
│   ├── roles.js           # Role management
│   └── system.js          # Logs (paginated + export), stats, settings
├── middleware/
│   ├── auth.js            # JWT authenticate + RBAC authorize
│   ├── rateLimit.js       # Per-endpoint rate limiters
│   ├── validation.js      # Zod-based request validation
│   └── ipAllowlist.js     # IP allowlist middleware
└── frontend/src/
    ├── pages/             # Dashboard, Backups, Repos, Logs, Settings, etc.
    ├── components/
    │   ├── ErrorBoundary.js  # Global React error boundary
    │   ├── Sidebar.js
    │   └── TopBar.js
    └── context/           # AuthContext, LangContext, SocketContext
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | Authenticate user (rate limited: 5/15 min) |
| POST | `/api/logout` | Logout + audit log |
| GET/POST | `/api/backups` | List (paginated) / Create backup |
| GET | `/api/backups?export=csv\|json` | Export all backups |
| PUT/DELETE | `/api/backups/:id` | Update / Delete backup |
| POST | `/api/backups/:id/run` | Execute backup (rate limited: 10/min) |
| GET | `/api/backups/:id/download` | Download backup file |
| GET | `/api/schedules` | List schedules (with lastRunAt) |
| GET/POST/DELETE | `/api/users` | Manage users |
| GET/POST/DELETE | `/api/roles` | Manage roles |
| GET | `/api/logs?page=1&limit=100` | View logs (paginated) |
| GET | `/api/logs?export=csv\|json` | Export all logs |
| GET/PUT | `/api/settings` | System settings |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/health` | Health check |
| GET | `/api/tools` | CLI tool availability check |
| POST | `/api/cloud-credentials/:id/test` | Test cloud connectivity |

## Security Notes

- Set a strong `ENCRYPTION_KEY` in `.env` (min 32 chars, random)
- Set `DEFAULT_ADMIN_PASSWORD` in `.env` or change immediately after first login
- Enable HTTPS via `SSL_CERT_PATH` and `SSL_KEY_PATH` in `.env`
- Configure `ALLOWED_IPS` in `.env` for IP allowlisting

## License

MIT
