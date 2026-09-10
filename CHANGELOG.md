# Changelog

## [0.9.30] - 2026-09-10

### Виправлено (web console не стартувала)

- **Критично**: демон панікував на старті `Nesting at the root is no longer supported` (axum 0.8 заборонив `nest_service("/")` для SPA) — веб-консоль і `/dashboard` не працювали з моменту переходу на axum 0.8.
- SPA тепер на `fallback_service`: `/` і `/dashboard` віддають `index.html`, `/api/v1/*` як і раніше йдуть в API.
- Regression test `spa_fallback_serves_index_without_swallowing_api`.
- Тести: 215/215 passing.

## [0.9.29] - 2026-09-10

### Виправлено (автодовстановлення)

- **Критично (0.9.28 regression)**: демон crash-loop'ився (`Read-only file system`) на старих конфігах без `restore_root` — відносний дефолт `./data/restore` створювався від `/` під `ProtectSystem=strict`.
- `AppConfig::restore_root_resolved()`: legacy `./data/restore` резолвиться в `<datadir>/restore`; створення директорії best-effort (warn, не crash) — restore fail closed, демон стартує завжди.
- **Інсталер (sh + ps1)**: автостворення `<data>/restore`, авто-міграція `restore_root` в існуючі конфіги, перевірка що сервіс реально Running після рестарту (з діагностикою: TLS-bind, шляхи/права).
- Тести: 214/214 passing.

## [0.9.28] - 2026-09-10

### Безпека (production audit fixes)

- **SEC-001**: `restore_root` в конфігу (дефолт `./data/restore`, автостворення директорії) — restore працює з коробки; gRPC/REST/portal використовують один гейт.
- **SEC-002**: відмова старту на `0.0.0.0`/`::` без TLS без `BCK_ALLOW_PLAINTEXT=1`.
- **SEC-003**: bounded JWT revocation map (10k, evict expired + soonest-expiring).
- **SEC-004**: constant-time порівняння agent token без length oracle (REST + gRPC).
- **SEC-005**: SSRF — DNS-імена endpoint'ів відхиляються за замовчуванням (`BCK_ALLOW_DNS_ENDPOINTS=1` для довіреного DNS).
- **SEC-006**: TTL 24h для `bootstrap_admin.txt` + автоочистка.
- **Agent auth**: middleware приймає JWT або pre-shared токен (heartbeat реєстрація працює).
- **BUG-001**: scheduler на wall-clock UTC без дрейфу; **BUG-003**: логування помилок decrypt storage-секретів; **PERF-001**: batch upsert VMs в одній транзакції.
- **OPS-002**: `x-request-id` (Set + Propagate) для кореляції логів; tower-http `request-id` feature.
- **Axum 0.8**: міграція роутів `:id` → `{id}` (прибрано паніки `without_v07_checks`).
- **TLS**: полагоджено `serve_tls` під tokio-rustls 0.24 / rustls 0.21.

### Тести

- 212/212 passing (`cargo test -p bck-core --lib`).

## [0.8.6] - 2026-09-02

### Безпека (remaining audit)

- **JWT**: in-memory denylist + `POST /auth/logout`, реальний SHA256 для protoc (3e8666...), tenant-фільтр для `list_events`, warn для legacy `enc:`.

## [0.8.5] - 2026-09-02

### Додано

- **Backup**: щоденний бекап `bck.db` в `db_backups/` (ротація 7), **Metrics**: `GET /metrics` Prometheus.

## [0.8.3] - 2026-09-02

### Безпека (audit hardening)

- **C1**: прибрано витік `encryption_key` з `agent_tasks.payload` (gRPC).
- **C2**: `PRAGMA foreign_keys=ON + WAL` для SQLite.
- **C3**: `tenant_id` для VM jobs, **C4** tenant-check для instant recovery, **C5** allowlist `file_restore`.
- **H2-H12**: decompress ліміт 64M, SSRF блок private/loopback (`BCK_ALLOW_PRIVATE_ENDPOINTS=1`), Argon2id 64M/3, атомарна міграція ключа, HSTS, CDP bounded 1024, constant-time токен.
- **Systemd**: `NoNewPrivileges/ProtectSystem/PrivateTmp`, **CI**: `cargo audit` + `healthz` probe.

## [0.8.0] - 2026-09-01

### Додано

- **Відновлено підтримку Windows**: повернуто `scripts/install.ps1` (PowerShell, `irm ... | iex`), що завантажує реліз-архів `bck-windows-x86_64.zip`, встановлює бінарники/веб-консоль у `%ProgramFiles%\BCK`, генерує `config.toml` (не перезаписуючи існуючий) і реєструє `bckd` як Windows-сервіс з автоперезапуском; при потребі збірки з джерела автоматично підтягує Rust, Git, protoc, Node.js та MSVC Build Tools.
- **CI**: додано `.github/workflows/ci.yml` — `cargo test --workspace` автоматично запускається на кожен push/PR у `main` (раніше тести запускались лише вручну; README-бейдж CI посилався на неіснуючий `ci.yml`).
- **Release CI**: у `.github/workflows/release.yml` повернуто job `build-windows` (windows-latest), що білдить `cargo build --release --workspace --bins`, пакує `bck-windows-x86_64.zip` (+ `.sha256`) і публікує його поруч з лінукс-архівом у GitHub Release.

### Змінено

- README: додано розділ встановлення на Windows поруч з Ubuntu/Debian, оновлено platform-бейдж; виправлено CI-бейдж, який вказував на неіснуючий репозиторій `ajjs1ajjs/BCK-source` (застаріла назва цього ж репозиторію) — тепер вказує на `ajjs1ajjs/BCK`.

## [0.7.2] - 2026-08-31

### Змінено

- **Лише Ubuntu / Debian**: видалено `install.ps1` (Windows-інсталятор), Windows-білд із `release.yml` та Docker-розгортання (Dockerfile, docker-compose.yml). Тепер встановлення/розгортання підтримується лише на Ubuntu / Debian через `scripts/install.sh`.
- **PWA**: веб-консоль тепер є повноцінним Progressive Web App (service worker + manifest, офлайн-режим, встановлення на пристрій).

