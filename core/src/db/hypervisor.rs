use anyhow::Result;

use crate::db::models::hypervisor::HypervisorModel;
use crate::db::DbPool;
use crate::integrations::HypervisorConnector;

pub async fn fetch_hypervisors(db: &DbPool) -> Result<Vec<HypervisorModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query_as::<_, HypervisorModel>(
                "SELECT id, name, hv_type, host, port, credentials_json, ssl_thumbprint,
                        status, version, created_at, updated_at
                 FROM hypervisors ORDER BY created_at DESC"
            )
            .fetch_all(pool)
            .await?;
            Ok(rows)
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query_as::<_, HypervisorModel>(
                "SELECT id, name, hv_type, host, port, credentials_json, ssl_thumbprint,
                        status, version, created_at, updated_at
                 FROM hypervisors ORDER BY created_at DESC"
            )
            .fetch_all(pool)
            .await?;
            Ok(rows)
        }
    }
}

pub async fn fetch_hypervisor(db: &DbPool, id: &str) -> Result<Option<HypervisorModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let row = sqlx::query_as::<_, HypervisorModel>(
                "SELECT id, name, hv_type, host, port, credentials_json, ssl_thumbprint,
                        status, version, created_at, updated_at
                 FROM hypervisors WHERE id = ?1"
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
        DbPool::Postgres(pool) => {
            let row = sqlx::query_as::<_, HypervisorModel>(
                "SELECT id, name, hv_type, host, port, credentials_json, ssl_thumbprint,
                        status, version, created_at, updated_at
                 FROM hypervisors WHERE id = $1"
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
    }
}

/// Build a hypervisor connector from a stored model (reads credentials).
pub fn connector_from_model(m: &HypervisorModel) -> Result<Box<dyn HypervisorConnector>> {
    let creds: serde_json::Value = serde_json::from_str(&m.credentials_json)
        .unwrap_or_else(|_| serde_json::json!({}));
    let username = creds["username"].as_str().unwrap_or("").to_string();
    let password = creds["password"].as_str().unwrap_or("").to_string();
    let ignore_ssl = creds["ignore_ssl"].as_bool().unwrap_or(false);
    let use_ssl = m.port == 5986 || m.port == 443;

    match m.hv_type.to_lowercase().as_str() {
        "hyperv" => Ok(crate::integrations::hyperv::create_connector(
            &m.host, &username, &password, use_ssl,
        )),
        "vmware" | "esxi" | "vsphere" => Ok(crate::integrations::vmware::create_connector(
            &m.host, m.port as u16, &username, &password, ignore_ssl,
        )),
        other => Err(anyhow::anyhow!("Unsupported hypervisor type: {}", other)),
    }
}

/// Mark a VM as protected after a successful backup.
pub async fn mark_vm_backed_up(db: &DbPool, hypervisor_id: &str, mo_ref: &str, t: i64) -> Result<()> {
    match db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "UPDATE vms SET protection_status = 'protected', last_backup = ?1, updated_at = ?1
                 WHERE hypervisor_id = ?2 AND mo_ref = ?3"
            )
            .bind(t)
            .bind(hypervisor_id)
            .bind(mo_ref)
            .execute(pool)
            .await?;
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "UPDATE vms SET protection_status = 'protected', last_backup = $1, updated_at = $1
                 WHERE hypervisor_id = $2 AND mo_ref = $3"
            )
            .bind(t)
            .bind(hypervisor_id)
            .bind(mo_ref)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}
