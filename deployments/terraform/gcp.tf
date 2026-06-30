# BCK Backup Manager — GCP Deployment

provider "google" {
  project = var.gcp_project
  region  = var.gcp_region
}

variable "gcp_project" {}
variable "gcp_region" { default = "us-central1" }

resource "google_compute_network" "bck" {
  name = "bck-network"
}

resource "google_sql_database_instance" "bck" {
  name = "bck-postgres"
  database_version = "POSTGRES_16"
  region = var.gcp_region
  settings {
    tier = "db-custom-2-4096"
    disk_size = 50
  }
}

resource "google_sql_database" "bck" {
  name     = "backupmanager"
  instance = google_sql_database_instance.bck.name
}

resource "google_redis_instance" "bck" {
  name           = "bck-redis"
  tier           = "BASIC"
  memory_size_gb = 2
  region         = var.gcp_region
}

resource "google_cloud_run_service" "api" {
  name = "bck-api"
  location = var.gcp_region
  template {
    spec {
      containers {
        image = "bck/backup-api:latest"
        ports { container_port = 8080 }
        env {
          name = "DB_HOST"; value = google_sql_database_instance.bck.public_ip_address
        }
        env {
          name = "REDIS_HOST"; value = google_redis_instance.bck.host
        }
      }
    }
  }
}

output "api_url" { value = google_cloud_run_service.api.status[0].url }
