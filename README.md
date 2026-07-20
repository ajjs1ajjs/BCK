<<<<<<< HEAD
# BCK
=======
# BCK Enterprise — Backup & Disaster Recovery

Повноцінна enterprise-система бекапів та аварійного відновлення (аналог Veeam / Nakivo), написана повністю на Rust.

## Архітектура

| Компонент | Опис | Технологія |
|-----------|------|-----------|
| **bckd** | Головний демон: REST API + gRPC + scheduler | Rust (Axum + Tonic) |
| **bck-agent** | Агент для захищених машин | Rust |
| **bck-proxy** | Backup proxy (SAN, NFS, HotAdd) | Rust |
| **bck** | CLI для управління | Rust (clap) |
| **web-ui** | Веб-інтерфейс управління | React + TypeScript |
| **Database** | PostgreSQL (SQLite для single-node) | sqlx |
| **Storage** | Local FS, S3, Azure Blob, GCS, Tape | Rust |

## Швидкий старт

```bash
# Збірка
cargo build --release

# Запуск демона (з SQLite)
./target/release/bckd

# Або з PostgreSQL + MinIO (docker)
docker compose up -d
```

## Розробка

```bash
# Перевірка компіляції
cargo check

# Запуск тестів
cargo test

# Запуск демона в dev режимі
RUST_LOG=debug cargo run -p bckd
```

## CLI

```bash
# Створити задачу бекапу
bck job create "Daily Backup" /data my-repo

# Запустити
bck job run <id>

# Статус
bck status
```

## API Endpoints

```
GET    /api/v1/jobs
POST   /api/v1/jobs
GET    /api/v1/jobs/:id
POST   /api/v1/jobs/:id/run
POST   /api/v1/jobs/:id/cancel
GET    /api/v1/repositories
GET    /api/v1/snapshots
POST   /api/v1/restore
GET    /api/v1/dashboard/stats
POST   /api/v1/auth/login
```

## Ліцензія

MIT
>>>>>>> ee25c8a (Initial commit: BCK backup system)
