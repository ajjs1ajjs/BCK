# BCK Backup Manager — Azure Deployment

provider "azurerm" {
  features {}
}

variable "resource_group" { default = "bck-rg" }
variable "location" { default = "West Europe" }

resource "azurerm_resource_group" "bck" {
  name = var.resource_group; location = var.location
}

resource "azurerm_postgresql_server" "bck" {
  name = "bck-postgres"
  location = azurerm_resource_group.bck.location
  resource_group_name = azurerm_resource_group.bck.name
  sku_name = "GP_Gen5_4"
  version = "16"
  administrator_login = "bck_admin"
  administrator_login_password = var.db_password
  ssl_enforcement_enabled = true
}

resource "azurerm_postgresql_database" "bck" {
  name = "backupmanager"
  resource_group_name = azurerm_resource_group.bck.name
  server_name = azurerm_postgresql_server.bck.name
}

resource "azurerm_redis_cache" "bck" {
  name = "bck-redis"
  location = azurerm_resource_group.bck.location
  resource_group_name = azurerm_resource_group.bck.name
  capacity = 1
  family = "C"
  sku_name = "Basic"
}

resource "azurerm_container_group" "bck" {
  name = "bck-api"
  location = azurerm_resource_group.bck.location
  resource_group_name = azurerm_resource_group.bck.name
  ip_address_type = "Public"
  dns_name_label = "bck-api"
  os_type = "Linux"

  container {
    name = "api"
    image = "bck/backup-api:latest"
    cpu = 1; memory = 2
    ports { port = 8050; protocol = "TCP" }
    environment_variables = {
      DB_HOST = azurerm_postgresql_server.bck.fqdn
      REDIS_HOST = azurerm_redis_cache.bck.hostname
    }
  }
}

output "api_fqdn" { value = azurerm_container_group.bck.fqdn }

variable "db_password" { sensitive = true }
