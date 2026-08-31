# Changelog

## [0.7.2] - 2026-08-31

### Змінено

- **Лише Ubuntu / Debian**: видалено `install.ps1` (Windows-інсталятор), Windows-білд із `release.yml` та Docker-розгортання (Dockerfile, docker-compose.yml). Тепер встановлення/розгортання підтримується лише на Ubuntu / Debian через `scripts/install.sh`.
- **PWA**: веб-консоль тепер є повноцінним Progressive Web App (service worker + manifest, офлайн-режим, встановлення на пристрій).

