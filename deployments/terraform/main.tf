terraform {
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.30" }
    helm = { source = "hashicorp/helm", version = "~> 2.14" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

resource "random_password" "jwt_secret" {
  length  = 32
  special = false
}

resource "random_password" "db_password" {
  length  = 16
  special = false
}

resource "helm_release" "bck" {
  name       = "bck"
  repository = "./deployments/helm"
  chart      = "bck-backup-manager"

  set {
    name  = "config.jwtSecret"
    value = random_password.jwt_secret.result
  }

  set {
    name  = "postgresql.auth.password"
    value = random_password.db_password.result
  }

  depends_on = [kubernetes_namespace.bck]
}

resource "kubernetes_namespace" "bck" {
  metadata {
    name = "backup-manager"
  }
}

output "api_endpoint" {
  value = "http://${helm_release.bck.name}-api:8080"
}

output "ui_endpoint" {
  value = "http://${helm_release.bck.name}-ui:3000"
}
