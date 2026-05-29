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
  token    = "bck_tok_abc123xyz" # API Token generated in BCK Admin Dashboard
}

# Example 1: Configure database connection credentials
# (Currently managed via UI, or can be queried via datasource if added)

# Example 2: Declare an automated database backup job
resource "bck_backup" "prod_database_backup" {
  name        = "Production Database Backup (S3)"
  type        = "mysql" # mysql, postgres, oracle, mongodb, host, vmware, hyperv
  source      = "db-conn-uuid-12345" # Database connection ID from BCK DB Connections list
  destination = "backup_prod_db.sql"
  backup_type = "cloud" # local or cloud
  config      = jsonencode({
    cloudCredentialId = "cloud-s3-creds-uuid-67890" # Credential ID from BCK Cloud list
    encryption        = true
    encryptionPassword = "SuperSecureEncryptionPasswordPhrase"
  })
}

# Example 3: Schedule the database backup daily at midnight
resource "bck_schedule" "daily_db_backup" {
  name            = "Daily Midnight Backup"
  cron_expression = "0 0 * * *"
  backup_id       = bck_backup.prod_database_backup.id
  enabled         = true
  notify_on       = "failure" # always, failure, never
  description     = "Automated daily mysql backup to S3 compatibility storage"
}
