# Operations & Security

## First login

On first start the daemon seeds an `admin` account with a randomly generated password. It is printed to the console once and written to `bootstrap_admin.txt` (mode `0600`) next to the data directory. Change it immediately after first login, then delete `bootstrap_admin.txt`. There is no hardcoded `admin/admin`.

## Secrets

`BCK_JWT_SECRET`, `BCK_AGENT_TOKEN` and the encryption key are auto-generated and persisted with `0600` permissions under the data dir when not configured explicitly. For production set them explicitly via `config.toml` / environment.

## TLS

Set `server.tls_cert` / `server.tls_key` in `config.toml` to serve HTTPS. Otherwise terminate TLS at a reverse proxy. gRPC (agents) is not TLS-terminated by the daemon; agents authenticate with the shared `BCK_AGENT_TOKEN`.

## Key protection

The encryption key lives in `data/keys/encryption.key` (outside the backups directory) with `0600`. Set `encryption.passphrase` in `config.toml` to wrap the key at rest with an Argon2id-derived key.

## Access control

REST API enforces RBAC. Everyone can read; `Operator`+ can create/run/delete jobs, `Operator` and `RestoreOperator` can restore, `Admin`/`SuperAdmin` manage tenants and admin portal. Cross-origin requests are denied unless the origin is explicitly allowed via `server.allowed_origins`.

## Private storage endpoints

Custom S3 endpoints that resolve to `127.0.0.1`/`10.x`/`192.168.x` are blocked by default (SSRF hardening). For on-prem S3 set `BCK_ALLOW_PRIVATE_ENDPOINTS=1`.

## Health & metrics

- `GET /api/v1/healthz` — liveness/readiness probe (checks DB, no auth).
- `GET /api/v1/metrics` — Prometheus `bck_jobs_total` / `bck_jobs_running`.
- `POST /api/v1/auth/logout` — revokes JWT (in-memory denylist).

## Backup

SQLite DB is copied daily to `db_backups/` via `VACUUM INTO` (rotation 7).

## Ports

- `9440` — REST API + Web UI
- `9441` — gRPC API
