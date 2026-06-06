# BCK Backup System

Enterprise-grade web-based backup management system with scheduling, monitoring, multi-source support, role-based access control, real-time analytics, multi-tenancy, and PWA support.

## Features

- **Backup Management** — Create, run, and monitor database, VM, cloud, SSH, and host backups
- **Scheduling** — Cron-based automated backup schedules with `lastRunAt` tracking
- **Restore** — One-click restore from any backup point
- **Multi-Source** — MySQL, PostgreSQL, Oracle, MSSQL, MongoDB, Redis; VMware, Hyper-V; AWS S3, GCS, Azure Blob; MinIO (S3-compatible); SSH remote; Linux/Windows host directories
- **Dashboard Analytics** — Real-time charts (area, pie), storage gauges, activity timeline, backup engine and status distribution
- **Repositories & S3 Versioning** — Browse all backups, disk usage, download/delete; track and restore S3 object versions
- **Multi-Tenant Organizations** — Manage multiple organizations with isolated data, default org always protected
- **API Tokens** — Generate `bck_` prefixed tokens for CI/CD pipelines; scoped permissions, expiry, one-time reveal
- **LDAP / Active Directory SSO** — Authenticate enterprise users against LDAP/AD with group-to-role mappings
- **Outgoing Webhooks** — Typed event subscriptions, HMAC-SHA256 signatures, exponential backoff retries, and delivery history logs
- **Terraform Provider** — Provision backups, schedules, and connections declaratively via custom Go-based provider
- **Prometheus Metrics** — `/metrics` endpoint with HTTP counters, backup stats, disk gauges, Node.js internals (optional `METRICS_TOKEN` protection)
- **Grafana Integration** — Pre-built auto-provisioned dashboard; full Prometheus + Grafana stack via `docker-compose.full.yml`
- **MinIO S3 Storage** — S3-compatible object storage included in the full stack; plug-in as cloud destination
- **PWA (Progressive Web App)** — Installable on mobile/desktop; offline shell; app shortcuts; Apple/Android meta tags
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
| Database  | PostgreSQL (via `pg`) |
| Scheduling | `node-cron` |
| Security  | `helmet`, `express-rate-limit`, JWT, bcrypt, AES-256 |
| Build     | Create React App |

## Quick Start

### Linux (one-line install)
```bash
# ⚠️ Review the install script first before piping to sudo:
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
Default credentials: `admin` / auto-generated (printed on first start) — **change on first login**

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
│   ├── queue.js           # Async backup execution queue
│   ├── webhooks.js        # Webhooks dispatch & retry service
│   ├── ldap.js            # LDAP/Active Directory SSO service
│   └── s3versions.js      # S3 object versioning & restore service
├── routes/
│   ├── auth.js            # Login, logout, 2FA (TOTP), LDAP/AD auth
│   ├── backups.js         # CRUD + run + download + export (CSV/JSON)
│   ├── connections.js     # DB / SSH / Cloud credential management
│   ├── schedules.js       # Cron schedules + lastRunAt + log pruning cron
│   ├── users.js           # User management
│   ├── roles.js           # Role management
│   ├── webhooks.js        # Webhooks CRUD & test
│   ├── versions.js        # S3 object version list, enable, restore
│   └── system.js          # Logs (paginated + export), stats, settings
├── middleware/
│   ├── auth.js            # JWT authenticate + RBAC authorize
│   ├── rateLimit.js       # Per-endpoint rate limiters
│   ├── validation.js      # Zod-based request validation
│   └── ipAllowlist.js     # IP allowlist middleware
├── terraform-provider/    # Go-based custom Terraform Provider configurations & examples
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
| POST | `/api/auth/ldap` | LDAP / Active Directory SSO Login |
| POST | `/api/auth/ldap/test` | Test LDAP server credentials and connection |
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
| GET/POST/DELETE | `/api/webhooks` | CRUD operations for outgoing webhook endpoints |
| POST | `/api/webhooks/:id/test` | Test-fire ping payload to webhook |
| GET | `/api/webhooks/:id/deliveries` | Retrieve delivery logs for webhook |
| GET | `/api/versions/:backupId` | List object versions in S3/MinIO bucket |
| POST | `/api/versions/:backupId/enable` | Enable object versioning on S3 bucket |
| POST | `/api/versions/:id/restore` | Restore specific version ID from S3 |

## Security Notes

- Set a strong `ENCRYPTION_KEY` in `.env` (min 32 chars, random)
- Set `DEFAULT_ADMIN_PASSWORD` in `.env` or change immediately after first login
- Enable HTTPS via `SSL_CERT_PATH` and `SSL_KEY_PATH` in `.env`
- Configure `ALLOWED_IPS` in `.env` for IP allowlisting

## License

MIT
