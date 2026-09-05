-- Data-plane multi-tenancy: tag repositories, jobs and snapshots with a tenant.
-- NULL = global/system resources (single-tenant deployments, super-admins).

ALTER TABLE repositories ADD COLUMN tenant_id TEXT;
ALTER TABLE backup_jobs ADD COLUMN tenant_id TEXT;
ALTER TABLE snapshots ADD COLUMN tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_repositories_tenant ON repositories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_tenant ON backup_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_tenant ON snapshots(tenant_id);
