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

## Security headers

The API server automatically adds the following security headers to every response:

- **Content-Security-Policy**: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`
- **X-Content-Type-Options**: `nosniff` — prevents MIME-type sniffing
- **X-Frame-Options**: `DENY` — prevents clickjacking via framing
- **Referrer-Policy**: `same-origin` — limits referrer information sent
- **Strict-Transport-Security**: `max-age=63072000; includeSubDomains; preload` — only served when TLS is enabled via `server.tls_cert` / `server.tls_key` in `config.toml`

These headers provide defense-in-depth against XSS, clickjacking, and protocol downgrade attacks.

## Backup

SQLite DB is copied daily to `db_backups/` via `VACUUM INTO` (rotation 7).

## Ports

- `9440` — REST API + Web UI
- `9441` — gRPC API

## Configuration defaults

Fresh installs bind the API to `127.0.0.1` (loopback only) by default. To expose the API on all interfaces, set `host = "0.0.0.0"` in `config.toml` and ensure TLS is configured via `server.tls_cert` / `server.tls_key`, or terminate TLS at a reverse proxy.

## Security improvements in this release (10/10 round)

- gRPC split planes: Agent service = agent token/JWT; Backup/SOBR/Cloud/M365 = user JWT + RBAC + tenant scope (agent token rejected).
- Portal BOLA closed: `tenant_id` stamped + per-tenant list/approve/reject/complete; approvers = `can_mutate` (Admin/Operator, no RestoreOperator).
- Tenants helpers delegate to centralized `policy::*`; long-lived `api` tokens removed.
- Middleware uses segment matching (no `contains` over-match); `/metrics` requires auth; lists paginated (`?limit=&offset=`, cap 1000).
- Dashboard 8 queries run concurrently; SOBR O(n²)→O(n); `list_blocks` sanitized.
- Download streams 64KiB chunks with 256MiB cap (413 beyond).
- Graph client 30s/10s timeouts; Azure tenant_id strictly validated.
- iSCSI CHAP-user gate (`BCK_ISCSI_CHAP_USER`) + NFS/iSCSI peer ACL (non-loopback needs `BCK_ALLOW_PUBLIC_INSTANT_RECOVERY=1`).
- Web UI: JWT in memory + sessionStorage (no persistent localStorage), httpOnly cookie, `/admin` role-guard, CSP meta.
- install.sh: `BCK_REQUIRE_CHECKSUM=1` fail-closed; CI pins cargo-audit/deny versions + `npm audit`; deny bans wildcards/multi-versions, denies unknown registries.
- Hypervisor test errors mapped to stable codes (no internal leakage).

- JWT token revocation mechanism fixed — tokens can now be properly revoked via the `jwt.revoke()` method, and revoked tokens are denied on subsequent validation.
- Security headers now included on all API responses: CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and HSTS (when TLS is enabled).
- NFS proxy connection handler now properly rejects connections with a clear error message (functional implementation is in progress).
- SEC-001: VM restore `target_datastore` gated through `restore_root` allow-list (route + orchestrator + gRPC).
- SEC-002: Instant Recovery decodes (decompress+decrypt) and SHA-verifies blocks; corrupt overlap is a hard error, not silent zeros; 8MiB read cap.
- SEC-003: agent shared secret valid for `/heartbeat` only; poll/report require per-agent JWT (sub-bound, 24h).
- SEC-005: tape `format` device_path allow-listed inside `<datadir>/tapes` (`BCK_TAPE_ROOT` override).
- SEC-006: snapshot file download capped at 256MiB (413 beyond); use chunked restore for larger.
- SEC-007: NFS/iSCSI accept loops bounded to 64 conns; exports remain loopback-only by default (opening to network = public snapshot bytes).
- SEC-008: M365/SSO/LDAP + repository `access_key` encrypted at rest (`enc:`); legacy plaintext migrates transparently.
- SEC-009: hypervisor host SSRF guard (metadata/link-local blocked; private/DC via `BCK_ALLOW_PRIVATE_HV=1`).
- SEC-010: login issues httpOnly `bck_token` cookie (Lax); API accepts Bearer or cookie; `/admin` has client role-guard.
- SEC-011/012: login throttle bounded per-key; legacy SHA-256 auto-rehashed to Argon2 on login.
- BUG-001: repository capacity enforced atomically (`UPDATE ... WHERE used_bytes+?<=capacity`).
- BUG-002: CDP journal offloaded via `spawn_blocking` (no blocking rusqlite on async runtime).
- PERF-001: SOBR dedup O(n²)→O(n) via HashSet; `list_blocks` prefix sanitized.

## Architecture round 2 (durability + scale, 10/10)

- Enterprise state (SOBR/CDP/DR/M365/portal) persists in `persisted_state` KV
  (write-through on mutation + 60s snapshot + hydrate on boot). Restarts no
  longer lose policies/plans/tenants/requests.
- Scheduler: worker pool (4 concurrent starts, short JM locks) + durable
  `job_queue` (claim-due atomically, survives restarts).
- Envelope encryption: per-repo DEK (`repo_keys`, wrapped by app KEK).
  New repos get a fresh DEK; legacy repos fall back to the app key.
  KEK rotation never re-encrypts backup blocks.
- S3 Object Lock: `object_lock_days` per repo (COMPLIANCE WORM).
  Requires an Object Lock-enabled bucket; failures are fail-closed.
- Range downloads: `Range: bytes=a-b` → 206 + Content-Range (chunk >256MiB
  files page by page).
- Metrics: `bck_jobs_failed`, `bck_snapshots_total`, `bck_restores_*` added
  (auth-gated `/metrics`).
- Ransomware smoke signal: `ransomware_suspected` event on
  compression+dedup collapse (alerts, never auto-deletes).
- M365 delta: `get_delta_page` follows `@odata.deltaLink` (persist the link
  per job for incremental runs).
- SureBackup lab isolation: run instant-recovery exports on loopback +
  stop/cleanup sessions immediately after verification; opening the lab to
  the network requires `BCK_ALLOW_PUBLIC_INSTANT_RECOVERY=1` (accepted risk,
  documented).
