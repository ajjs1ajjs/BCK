-- Enterprise HA + legal hold (Veeam-alt round).

CREATE TABLE IF NOT EXISTS leader_lock (
    id TEXT PRIMARY KEY CHECK (id = 'leader'),
    owner TEXT NOT NULL,
    heartbeat BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS legal_holds (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    released_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_holds_snapshot ON legal_holds(snapshot_id);
