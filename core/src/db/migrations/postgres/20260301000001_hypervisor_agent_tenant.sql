-- Multi-tenancy for infrastructure tables (hypervisors, agents).
-- See sqlite counterpart for context.

ALTER TABLE hypervisors ADD COLUMN tenant_id TEXT;
ALTER TABLE agents ADD COLUMN tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_hypervisors_tenant ON hypervisors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
