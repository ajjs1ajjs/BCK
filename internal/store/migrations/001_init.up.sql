CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users & Auth
CREATE TYPE user_role AS ENUM ('admin', 'operator', 'viewer', 'auditor');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- Refresh tokens
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Repositories
CREATE TYPE repository_status AS ENUM ('active', 'inactive', 'error');

CREATE TABLE repositories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    storage_type VARCHAR(50) NOT NULL DEFAULT 'local',
    storage_config JSONB NOT NULL DEFAULT '{}',
    encryption_key_id VARCHAR(255),
    compression VARCHAR(50) NOT NULL DEFAULT 'zstd',
    status repository_status NOT NULL DEFAULT 'active',
    total_size_bytes BIGINT NOT NULL DEFAULT 0,
    total_chunks BIGINT NOT NULL DEFAULT 0,
    total_snapshots BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_repositories_status ON repositories(status);

-- Backup Jobs
CREATE TYPE job_status AS ENUM ('active', 'paused', 'disabled');
CREATE TYPE job_run_status AS ENUM ('pending', 'running', 'success', 'failed', 'cancelled');

CREATE TABLE backup_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    source_path TEXT NOT NULL,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    cron_expression VARCHAR(100),
    exclude_patterns TEXT[] DEFAULT '{}',
    status job_status NOT NULL DEFAULT 'active',
    retention_policy_id UUID,
    max_retries INT NOT NULL DEFAULT 3,
    timeout_seconds INT NOT NULL DEFAULT 3600,
    chunk_size_bytes INT NOT NULL DEFAULT 4194304,
    compression_level INT NOT NULL DEFAULT 3,
    notify_on_success BOOLEAN NOT NULL DEFAULT false,
    notify_on_failure BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backup_jobs_repo ON backup_jobs(repository_id);
CREATE INDEX idx_backup_jobs_status ON backup_jobs(status);
CREATE INDEX idx_backup_jobs_cron ON backup_jobs(cron_expression) WHERE cron_expression IS NOT NULL;

-- Job Runs
CREATE TABLE job_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
    status job_run_status NOT NULL DEFAULT 'pending',
    snapshot_id UUID,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_seconds FLOAT,
    bytes_processed BIGINT NOT NULL DEFAULT 0,
    bytes_uploaded BIGINT NOT NULL DEFAULT 0,
    files_processed BIGINT NOT NULL DEFAULT 0,
    files_skipped BIGINT NOT NULL DEFAULT 0,
    error_message TEXT,
    log_output TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_runs_job ON job_runs(job_id);
CREATE INDEX idx_job_runs_status ON job_runs(status);
CREATE INDEX idx_job_runs_started ON job_runs(started_at);

-- Snapshots
CREATE TABLE snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    job_id UUID REFERENCES backup_jobs(id) ON DELETE SET NULL,
    parent_snapshot_id UUID REFERENCES snapshots(id) ON DELETE SET NULL,
    snapshot_path TEXT NOT NULL,
    total_size_bytes BIGINT NOT NULL DEFAULT 0,
    file_count BIGINT NOT NULL DEFAULT 0,
    chunk_count BIGINT NOT NULL DEFAULT 0,
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_repo ON snapshots(repository_id);
CREATE INDEX idx_snapshots_job ON snapshots(job_id);
CREATE INDEX idx_snapshots_parent ON snapshots(parent_snapshot_id);
CREATE INDEX idx_snapshots_created ON snapshots(created_at);

-- Retention Policies
CREATE TYPE retention_frequency AS ENUM ('hourly', 'daily', 'weekly', 'monthly', 'yearly');

CREATE TABLE retention_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rules JSONB NOT NULL DEFAULT '[]',
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE backup_jobs
    ADD CONSTRAINT fk_backup_jobs_retention
    FOREIGN KEY (retention_policy_id) REFERENCES retention_policies(id) ON DELETE SET NULL;

-- Audit Logs
CREATE TYPE audit_action AS ENUM (
    'login', 'logout', 'login_failed',
    'job_create', 'job_update', 'job_delete', 'job_run',
    'repo_create', 'repo_update', 'repo_delete',
    'restore_start', 'restore_complete',
    'user_create', 'user_update', 'user_delete',
    'settings_update'
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action audit_action NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- Notifications
CREATE TYPE notification_type AS ENUM ('info', 'warning', 'success', 'error');
CREATE TYPE notification_channel AS ENUM ('email', 'telegram', 'webhook', 'discord');

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    channel notification_channel NOT NULL,
    type notification_type NOT NULL,
    title VARCHAR(500) NOT NULL,
    message TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- Insert default admin user (password: admin123)
INSERT INTO users (username, email, password_hash, role)
VALUES ('admin', 'admin@backupmanager.local', '$2a$10$...', 'admin');
-- Note: actual bcrypt hash will be generated in seed script
