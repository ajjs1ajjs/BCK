# BCK Enterprise — All-Rust Architecture

## Стек

| Компонент       | Технологія                         |
|----------------|-----------------------------------|
| Backup Engine  | **Rust** (Tokio + async)          |
| REST API       | **Rust** (Axum + Tower)           |
| gRPC           | **Rust** (Tonic + Prost)          |
| Database       | **sqlx** (PostgreSQL / SQLite)    |
| CLI            | **Rust** (Clap)                   |
| Web UI         | **React** + TypeScript + MUI      |
| Auth           | JWT + Argon2, SSO (OIDC + LDAP)   |
| Storage        | Local FS, S3, Azure Blob, GCS, Tape (LTFS) |

## Структура проекту

```
E:\Code\BCK\
├── core/          # бібліотека (вся логіка)
├── bckd/          # демон (Axum API + gRPC + scheduler)
├── agent/         # агент для машин
├── proxy/         # backup proxy
├── cli/           # CLI інструмент
├── web-ui/        # React фронтенд
├── scripts/       # installers (sh/ps1), build/check helpers
├── Cargo.toml     # workspace
└── docker-compose.yml
```

## Статус реалізації (актуальний, головна гілка)

| Компонент | Статус | Деталі |
|-----------|--------|--------|
| Core engine | ✅ | scanner → chunker (XXH3) → dedup (SHA-256) → compress (LZ4/Zstd/noop) → encrypt (AES-256/ChaCha20) |
| Storage | ✅ | Local FS, S3 (SigV4, MinIO path-style), Azure Blob, GCS |
| REST API | ✅ | jobs, repos, snapshots, restore, dashboard, auth, agents, hypervisors, events, **sso, sobr, cloud, m365, tape, cdp, dr** |
| gRPC | ✅ | Tonic + Prost; `BackupEngine` (реальний: start/cancel jobs, list snapshots, stats, health, restore), **SOBR / Cloud / M365 / Agent сервіси** |
| Database | ✅ | SQLite (rusqlite) default + PostgreSQL (sqlx) |
| Scheduler | ✅ | cron-подібні розклади |
| Auth | ✅ | JWT + Argon2; SSO OIDC (authorize/callback) + LDAP |
| CLI | ✅ | jobs, repos, snapshots, restore, status, logs, **cloud, sobr, m365, dr, hypervisor, portal, tenant** |
| Web UI | ✅ | 13 сторінок (Admin, Dashboard, Jobs, Login, Repositories, Restore, Snapshots, **SOBR, Cloud, M365, Tape, DR, Hypervisors**); SSO — секція в Admin |
| Instant Recovery | ✅ | реальні NFSv3 + iSCSI сервери |
| Restore Explorer | ✅ | перегляд снапшотів + витяг файлів |
| SureBackup | ✅ | валідація відновлення ВМ (register/unregister VM) |
| CDP | ✅ | watcher + replicator + checkpoints |
| DR | ✅ | реплікація, failover, тест failover (недеструктивний) |
| SOBR | ✅ | тіри, lifecycle engine (move/archive/seal/retention), real block movement |
| Tape (LTFS) | ✅ | `tape/mod.rs` + `tape/ltfs.rs` |
| M365 | ✅ | Graph OAuth2, mailbox / OneDrive / SharePoint експорт |
| Cloud | ✅ | AWS (EC2/EBS/RDS), Azure (VM/disk/SQL), GCP (GCE/disk/SQL), K8s (PVC) |
| VMware / Hyper-V | ✅ | connectors, changed-block tracking (CBT/RCT), power on/off, register/unregister VM, **VM backup job + instant recovery via REST API** |
| Enterprise | ✅ | Reports (SLA/CSV), SSO, audit log, **multi-tenancy (REST + Web UI + CLI)** |
| Agent | ✅ | file_backup, app-aware (VSS, SQL, Oracle archivelog) |
| Proxy | ✅ | backup proxy |
| CI/CD | ✅ | release.yml (GitHub Actions), install.sh/ps1, Dockerfile, docker-compose |

## Чек-лист фаз

### Phase 0 — Foundation ✅
- [x] Файловий бекап: scanner → chunker → dedup → compress → encrypt → storage
- [x] REST API (Axum) + JWT auth + Argon2
- [x] CLI (clap)
- [x] SQLite + PostgreSQL (sqlx)
- [x] Scheduler
- [x] Retention (GFS daily/weekly/monthly)

### Phase 1 — VM Backup ✅
- [x] VMware connector (snapshots, CBT, changed blocks, disks, power on/off, register VM)
- [x] Hyper-V connector (RCT changed blocks, disks, power state, register VM)
- [x] Повний VM backup job у демоні через API (VmBackupJob → pipeline → repository, JobManager `vm` job type, REST `POST /api/v1/hypervisors/:id/vms/:vm_ref/backup`, Web UI секція Hypervisors, CLI `bck hypervisor`)
- [x] Instant Recovery для VMware/Hyper-V через REST API (`POST /api/v1/restore/instant/vm` реєструє VM на hypervisor з бекуба, stop розреєстровує; Web UI + CLI)

### Phase 2 — Agent ✅
- [x] Агент-демон + polling задач
- [x] file_backup task
- [x] App-aware: VSS, SQL, Oracle archivelog

### Phase 3 — Restore ✅
- [x] Restore API (file / VM)
- [x] Restore Explorer
- [x] Instant Recovery (NFSv3, iSCSI)
- [x] SureBackup engine + інтеграція в демон

### Phase 4 — Enterprise ✅
- [x] CDP: watcher + replicator + checkpoints
- [x] DR: реплікація, failover, тест failover
- [x] Tape LTFS
- [x] M365: mailbox / OneDrive / SharePoint
- [x] SOBR: тіри + lifecycle (move/archive/seal/retention)
- [x] REST API для SOBR / CDP / DR / Tape / M365
- [x] Web UI сторінки

### Phase 5 — Cloud ✅
- [x] AWS: EC2 AMI, EBS snapshots, RDS snapshots/restore
- [x] Azure: VM, managed disks, SQL (ARM + OAuth2)
- [x] GCP: GCE images, disk snapshots, Cloud SQL
- [x] K8s: PVC + manifest backup
- [x] REST API для керування cloud accounts
- [x] Cloud restore через Web UI (CloudRestoreManager → REST /api/v1/cloud/{id}/restore, Web UI секція, CLI `bck cloud restore`)

### Phase 6 — Polish ✅
- [x] SSO (OIDC + LDAP) з HTTP routes
- [x] Reports / SLA / CSV
- [x] Audit log
- [x] Self-Service portal (RestoreRequest manager → REST /api/v1/portal, Web UI сторінка, CLI `bck portal`)
- [x] Multi-tenancy (TenantManager → REST /api/v1/tenants, Web UI сторінка, CLI `bck tenant`)
- [x] Розширення CLI на нові фічі (cloud, sobr, m365, dr)

## Наступні пріоритетні кроки

1. **gRPC**: реалізувати реальні RPC для SOBR / Cloud / M365 та підключити `BackupEngine` до AppState (job manager, DB). ✅
2. **Web UI**: сторінки SOBR, Cloud accounts, M365, DR, SSO + роутинг/навігація. ✅
3. **CLI**: підкоманди `bck cloud`, `bck sobr`, `bck m365`, `bck dr`. ✅
4. **Очищення warnings** (~12): unused imports у `restore/instant/*` та `agent`. ✅

## Відомі технічні борги

- ~12 compiler warnings (`unused_imports` / `unused_variables`) у `core/src/restore/instant/`, `agent/src/main.rs`. → cleaned, 0 warnings
- VMware register/unregister — перевірити на реальному vCenter.

## Тести

- **154 тест** у `bck-core` (всі проходять), бінарники — без тестів.
- SOBR lifecycle покритий (move, archive, seal, retention, shared blocks).
- Instant recovery (NFS/iSCSI/xdr), cloud XML parsing, M365 Graph, Hyper-V RCT — покриті.
- VM backup job покритий (unit: `backup::vm` блоки → storage; route: `POST .../vms/:ref/backup` + 404).
- Instant Recovery для VM покритий (unit: register/unregister VM на hypervisor; route: 404/400/GET list).
- gRPC покритий (8 unit-тестів: StartJob→JobManager, ListSnapshots, Health, SOBR tier, Cloud account, M365 tenant, Agent heartbeat/tasks, Agent status).
