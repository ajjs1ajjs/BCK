# BCK Backup System Terraform Provider

A custom Terraform provider for the BCK Backup Management System API. Manage backup jobs, automated schedules, and observe backup storage repositories declaratively using Infrastructure-as-Code.

## 🚀 Quick Start

### 1. Requirements
- [Terraform](https://www.terraform.io/downloads.html) >= 1.0
- [Go](https://golang.org/doc/install) >= 1.18 (to build from source)

### 2. Provider Installation
To build the provider binary from source, run:

```bash
go build -o terraform-provider-bck
```

Copy the built binary into your local plugins directory matching your system architecture:
- **Windows**: `%APPDATA%\terraform.d\plugins\registry.terraform.io\bck-backup\bck\1.0.0\windows_amd64\`
- **Linux**: `~/.terraform.d/plugins/registry.terraform.io/bck-backup/bck/1.0.0/linux_amd64/`
- **macOS**: `~/.terraform.d/plugins/registry.terraform.io/bck-backup/bck/1.0.0/darwin_amd64/`

---

## 🛠 Provider Configuration

Configure the provider with your BCK system endpoint and API Token:

```hcl
terraform {
  required_providers {
    bck = {
      source  = "bck-backup/bck"
      version = "~> 1.0.0"
    }
  }
}

provider "bck" {
  endpoint = "http://localhost:6000"
  token    = "bck_tok_xxxxxxxxxxxx" # API token generated in Settings -> API Tokens
}
```

---

## 📦 Supported Resources

### `bck_backup`
Manages backup jobs on the BCK server.

```hcl
resource "bck_backup" "app_db_backup" {
  name        = "Application Database Backup"
  type        = "postgres" # mysql, postgres, oracle, mongodb, host, vmware, hyperv
  source      = "db-conn-uuid-12345"
  destination = "bck_app_prod.sql"
  backup_type = "cloud" # local or cloud
  config      = jsonencode({
    cloudCredentialId  = "cloud-s3-creds-uuid"
    encryption         = true
    encryptionPassword = "SuperSecurePassword123"
  })
}
```

#### Argument Reference:
- `name` (String, Required) — A descriptive name for the backup job.
- `type` (String, Required) — The backup source engine (`mysql`, `postgres`, `oracle`, `mongodb`, `redis`, `host`, `vmware`, `hyperv`).
- `source` (String, Required) — Connection ID, Host ID, or VM identifier representing the source.
- `destination` (String, Required) — Target filename or local directory path.
- `backup_type` (String, Optional) — Storage target. Default is `local`. Set to `cloud` to sync to S3.
- `config` (String/JSON, Optional) — JSON object containing advanced settings such as `cloudCredentialId`, `encryption`, and `encryptionPassword`.

---

### `bck_schedule`
Manages cron-based automation schedules for backup jobs.

```hcl
resource "bck_schedule" "midnight_sync" {
  name            = "Midnight Database Backup"
  cron_expression = "0 0 * * *"
  backup_id       = bck_backup.app_db_backup.id
  enabled         = true
  notify_on       = "failure"
  description     = "Daily automated PostgreSQL backup synced to AWS S3"
}
```

#### Argument Reference:
- `name` (String, Required) — A descriptive name for the schedule.
- `cron_expression` (String, Required) — Standard crontab syntax schedule (e.g., `*/15 * * * *` for every 15 minutes).
- `backup_id` (String, Required) — The ID of the backup job to trigger.
- `enabled` (Boolean, Optional) — Enable or disable execution. Default: `true`.
- `notify_on` (String, Optional) — Notification event trigger level: `always`, `failure`, or `never`. Default: `never`.
- `description` (String, Optional) — A descriptive explanation of the schedule's purpose.
