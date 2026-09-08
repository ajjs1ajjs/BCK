-- Persistent JWT revocation (SEC-003): logout survives daemon restarts.
-- Stores SHA-256 of the token (never the token itself).

CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_hash TEXT PRIMARY KEY,
    exp BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_exp ON revoked_tokens(exp);
