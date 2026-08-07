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
| REST API | 🟡 | jobs, repos, snapshots, restore, dashboard, auth, agents, hypervisors, events, **sso** |
| gRPC | ✅ | Tonic + Prost, `BackupEngine` сервіс стартує в bckd |
| Database | ✅ | SQLite (rusqlite) default + PostgreSQL (sqlx) |
| Scheduler | ✅ | cron-подібні розклади |
| Auth | ✅ | JWT + Argon2; SSO OIDC (authorize/callback) + LDAP |
| CLI | 🟡 | jobs, repos, snapshots, restore, status, logs; **немає команд для нових фіч** |
| Web UI | 🟡 | 7 сторінок (Admin, Dashboard, Jobs, Login, Repositories, Restore, Snapshots); **немає сторінок для SOBR/Cloud/M365/Tape/DR/SSO** |
| Instant Recovery | ✅ | реальні NFSv3 + iSCSI сервери |
| Restore Explorer | ✅ | перегляд снапшотів + витяг файлів |
| SureBackup | ✅ | валідація відновлення ВМ (register/unregister VM) |
| CDP | ✅ | watcher + replicator + checkpoints |
| DR | ✅ | реплікація, failover, тест failover (недеструктивний) |
| SOBR | ✅ | тіри, lifecycle engine (move/archive/seal/retention), real block movement |
| Tape (LTFS) | ✅ | `tape/mod.rs` + `tape/ltfs.rs` |
| M365 | ✅ | Graph OAuth2, mailbox / OneDrive / SharePoint експорт |
| Cloud | ✅ | AWS (EC2/EBS/RDS), Azure (VM/disk/SQL), GCP (GCE/disk/SQL), K8s (PVC) |
| VMware / Hyper-V | 🟡 | connectors, changed-block tracking (CBT/RCT), power on/off, register/unregister VM |
| Enterprise | ✅ | Reports (SLA/CSV), SSO, audit log |
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

### Phase 1 — VM Backup 🟡
- [x] VMware connector (snapshots, CBT, changed blocks, disks, power on/off, register VM)
- [x] Hyper-V connector (RCT changed blocks, disks, power state, register VM)
- [ ] Повний VM backup job у демоні через API
- [ ] Instant Recovery для VMware/Hyper-V через REST API

### Phase 2 — Agent ✅
- [x] Агент-демон + polling задач
- [x] file_backup task
- [x] App-aware: VSS, SQL, Oracle archivelog

### Phase 3 — Restore ✅
- [x] Restore API (file / VM)
- [x] Restore Explorer
- [x] Instant Recovery (NFSv3, iSCSI)
- [x] SureBackup engine + інтеграція в демон

### Phase 4 — Enterprise 🟡
- [x] CDP: watcher + replicator + checkpoints
- [x] DR: реплікація, failover, тест failover
- [x] Tape LTFS
- [x] M365: mailbox / OneDrive / SharePoint
- [x] SOBR: тіри + lifecycle (move/archive/seal/retention)
- [ ] REST API для SOBR / CDP / DR / Tape / M365
- [ ] Web UI сторінки

### Phase 5 — Cloud 🟡
- [x] AWS: EC2 AMI, EBS snapshots, RDS snapshots/restore
- [x] Azure: VM, managed disks, SQL (ARM + OAuth2)
- [x] GCP: GCE images, disk snapshots, Cloud SQL
- [x] K8s: PVC + manifest backup
- [ ] REST API для керування cloud accounts
- [ ] Cloud restore через Web UI

### Phase 6 — Polish 🟡
- [x] SSO (OIDC + LDAP) з HTTP routes
- [x] Reports / SLA / CSV
- [x] Audit log
- [ ] Self-Service portal
- [ ] Multi-tenancy
- [ ] Розширення CLI на нові фічі (cloud, sobr, m365, dr)

## Наступні пріоритетні кроки

1. **REST роути** для `sobr`, `cloud`, `m365`, `tape`, `cdp`, `dr` у `core/src/server/routes/`
   (усі модулі готові в core — треба лише обгорнути в Axum handlers).
2. **Web UI**: сторінки SOBR, Cloud accounts, M365, DR, SSO + роутинг/навігація.
3. **CLI**: підкоманди `bck cloud`, `bck sobr`, `bck m365`, `bck dr`.
4. **Очищення warnings** (~12): unused imports у `restore/instant/*` та `agent`.

## Відомі технічні борги

- ~12 compiler warnings (`unused_imports` / `unused_variables`) у `core/src/restore/instant/`, `agent/src/main.rs`.
- gRPC реалізує базовий `BackupEngine`; розширити сервіс новими RPC (sobr, cloud, m365).
- Web UI не покриває Phase 4–6 фічі.
- CLI не покриває Phase 4–6 фічі.
- VMware register/unregister — перевірити на реальному vCenter.

## Тести

- **131 тест** у `bck-core` (всі проходять), бінарники — без тестів.
- SOBR lifecycle покритий (move, archive, seal, retention, shared blocks).
- Instant recovery (NFS/iSCSI/xdr), cloud XML parsing, M365 Graph, Hyper-V RCT — покриті.
