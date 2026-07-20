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
| Auth           | JWT + Argon2                       |
| Storage        | Local FS, S3, Azure Blob, GCS     |

## Структура проекту

```
E:\Code\BCK\
├── core/          # бібліотека (вся логіка)
├── bckd/          # демон (Axum API + gRPC + scheduler)
├── agent/         # агент для машин
├── proxy/         # backup proxy
├── cli/           # CLI інструмент
├── web-ui/        # React фронтенд
├── Cargo.toml     # workspace
└── docker-compose.yml
```

## Фази

- **Phase 0** (зараз): foundation — файловий бекап, dedup, compress, encrypt, REST API, CLI
- **Phase 1**: VM Backup (VMware CBT, Hyper-V RCT)
- **Phase 2**: Agent + Application-Aware (VSS, SQL, Oracle)
- **Phase 3**: Restore + Instant Recovery
- **Phase 4**: Enterprise (CDP, DR, Tape, M365, SOBR)
- **Phase 5**: Cloud (AWS, Azure, GCP, K8s)
- **Phase 6**: Polish (Self-Service, SSO, Reports, Multi-tenancy)
