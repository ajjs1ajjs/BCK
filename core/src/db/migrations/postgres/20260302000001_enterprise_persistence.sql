-- P0 durability (10/10): enterprise state survives restarts.

CREATE TABLE IF NOT EXISTS persisted_state (
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (domain, key)
);
CREATE INDEX IF NOT EXISTS idx_persisted_domain ON persisted_state(domain);

CREATE TABLE IF NOT EXISTS job_queue (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    run_at BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_queue_run ON job_queue(status, run_at);

CREATE TABLE IF NOT EXISTS repo_keys (
    repo_id TEXT PRIMARY KEY,
    enc_dek TEXT NOT NULL,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    created_at BIGINT NOT NULL
);
