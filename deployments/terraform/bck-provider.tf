terraform {
  required_providers {
    bck = {
      source  = "ajjs1ajjs/bck"
      version = "~> 1.0"
    }
  }
}

provider "bck" {
  api_url  = "http://localhost:8080/api/v1"
  token    = var.bck_token
}

variable "bck_token" { sensitive = true }

resource "bck_repository" "main" {
  name         = "terraform-managed-repo"
  storage_type = "local"
}

resource "bck_backup_job" "daily" {
  name            = "daily-backup-etc"
  source_path     = "/etc"
  repository_id   = bck_repository.main.id
  cron_expression = "0 0 2 * * *"  # 2:00 AM daily
  compression_level = 5
  notify_on_failure = true
}

resource "bck_backup_job" "weekly_db" {
  name            = "weekly-db-backup"
  source_path     = "postgresql://localhost:5432/mydb"
  repository_id   = bck_repository.main.id
  cron_expression = "0 0 3 * * 0"  # 3:00 AM Sundays
  retention_policy_id = bck_retention_policy.default.id
}

resource "bck_retention_policy" "default" {
  name = "default-gfs"
  rules = jsonencode([
    { frequency = "daily", keep = 7 },
    { frequency = "weekly", keep = 4 },
    { frequency = "monthly", keep = 12 },
  ])
}

output "repo_id" { value = bck_repository.main.id }
