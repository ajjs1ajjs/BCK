# Changelog

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

