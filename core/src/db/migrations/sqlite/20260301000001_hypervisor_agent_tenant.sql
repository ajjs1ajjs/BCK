-- Multi-tenancy for infrastructure tables (hypervisors, agents, restore
-- sessions). NULL = global/system resource (super-admin or single-tenant
-- deployments). Required for the SEC-004 / SEC-005 fixes that enforce
-- tenant isolation on /hypervisors and /agents.

ALTER TABLE hypervisors ADD COLUMN tenant_id TEXT;
ALTER TABLE agents ADD COLUMN tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_hypervisors_tenant ON hypervisors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
