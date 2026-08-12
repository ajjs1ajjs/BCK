-- Add tenant_id to users (NULL = global/system admin, or single-tenant deployments).

ALTER TABLE users ADD COLUMN tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
