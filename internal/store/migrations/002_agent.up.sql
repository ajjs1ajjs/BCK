CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    hostname VARCHAR(255),
    address VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 50051,
    version VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'offline',
    last_seen_at TIMESTAMPTZ,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    labels TEXT[] DEFAULT '{}',
    UNIQUE(address, port)
);

CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_last_seen ON agents(last_seen_at);

ALTER TABLE backup_jobs ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
CREATE INDEX idx_backup_jobs_agent ON backup_jobs(agent_id);
