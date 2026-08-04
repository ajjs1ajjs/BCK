-- BCK Enterprise: Initial Schema

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'operator',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_login INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo_type TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    capacity_bytes INTEGER NOT NULL DEFAULT 0,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    free_bytes INTEGER NOT NULL DEFAULT 0,
    encrypted INTEGER NOT NULL DEFAULT 0,
    immutable INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'uninitialized',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    job_type TEXT NOT NULL,
    backup_type TEXT NOT NULL DEFAULT 'incremental',
    source_config TEXT NOT NULL DEFAULT '{}',
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    schedule TEXT,
    retention_config TEXT NOT NULL DEFAULT '{"daily":7,"weekly":4,"monthly":12}',
    compression TEXT NOT NULL DEFAULT 'zstd',
    encryption INTEGER NOT NULL DEFAULT 0,
    bandwidth_limit INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_sessions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES backup_jobs(id),
    status TEXT NOT NULL DEFAULT 'running',
    backup_type TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    processed_bytes INTEGER NOT NULL DEFAULT 0,
    transferred_bytes INTEGER NOT NULL DEFAULT 0,
    dedup_ratio REAL,
    compression_ratio REAL,
    files_processed INTEGER NOT NULL DEFAULT 0,
    warnings_count INTEGER NOT NULL DEFAULT 0,
    errors_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES backup_jobs(id),
    session_id TEXT NOT NULL REFERENCES job_sessions(id),
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    snapshot_type TEXT NOT NULL,
    parent_id TEXT REFERENCES snapshots(id),
    size_bytes INTEGER NOT NULL DEFAULT 0,
    unique_bytes INTEGER NOT NULL DEFAULT 0,
    compressed_bytes INTEGER NOT NULL DEFAULT 0,
    checksum TEXT NOT NULL DEFAULT '',
    consistency TEXT NOT NULL DEFAULT 'crash_consistent',
    app_consistent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hypervisors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hv_type TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 443,
    credentials_json TEXT NOT NULL DEFAULT '{}',
    ssl_thumbprint TEXT,
    status TEXT NOT NULL DEFAULT 'unknown',
    version TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hypervisor_id TEXT NOT NULL REFERENCES hypervisors(id),
    mo_ref TEXT NOT NULL,
    power_state TEXT,
    os TEXT,
    cpu_count INTEGER NOT NULL DEFAULT 0,
    ram_mb INTEGER NOT NULL DEFAULT 0,
    disk_gb INTEGER NOT NULL DEFAULT 0,
    protection_status TEXT NOT NULL DEFAULT 'unprotected',
    last_backup INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    ip_address TEXT,
    os_type TEXT,
    os_version TEXT,
    agent_version TEXT,
    status TEXT NOT NULL DEFAULT 'offline',
    last_seen INTEGER,
    capabilities TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proxies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    proxy_type TEXT NOT NULL DEFAULT 'nfs',
    max_concurrent_tasks INTEGER NOT NULL DEFAULT 4,
    cpu_cores INTEGER,
    ram_gb INTEGER,
    status TEXT NOT NULL DEFAULT 'offline',
    load INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details TEXT,
    ip_address TEXT,
    outcome TEXT NOT NULL DEFAULT 'success',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    job_id TEXT,
    session_id TEXT,
    metadata TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_repo ON backup_jobs(repository_id);
CREATE INDEX IF NOT EXISTS idx_sessions_job ON job_sessions(job_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_job ON snapshots(job_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_repo ON snapshots(repository_id);
CREATE INDEX IF NOT EXISTS idx_vms_hypervisor ON vms(hypervisor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
