const { Pool } = require('pg');
const fs = require('fs');


const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'bckuser',
  password: process.env.DB_PASSWORD || 'bckdbpass',
  database: process.env.DB_NAME || 'bckdb',
});

function parseArgs(sql, args) {
  let query = sql;
  let params = [];
  
  if (!args || args.length === 0) return { query, params };
  
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
    let i = 1;
    const obj = args[0];
    query = query.replace(/@([a-zA-Z0-9_]+)/g, (match, p1) => {
      params.push(obj[p1]);
      return '$' + (i++);
    });
  } else {
    let i = 1;
    query = query.replace(/\?/g, () => {
      return '$' + (i++);
    });
    if (args.length === 1 && Array.isArray(args[0])) {
      params = args[0];
    } else {
      params = args;
    }
  }
  
  return { query, params };
}

const db = {
  get: async (sql, ...args) => {
    const { query, params } = parseArgs(sql, args);
    const res = await pool.query(query, params);
    return res.rows[0];
  },
  all: async (sql, ...args) => {
    const { query, params } = parseArgs(sql, args);
    const res = await pool.query(query, params);
    return res.rows;
  },
  run: async (sql, ...args) => {
    const { query, params } = parseArgs(sql, args);
    const res = await pool.query(query, params);
    return { changes: res.rowCount, lastInsertRowid: null };
  },
  transaction: (fn) => {
    return async (...args) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await fn(...args);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }
  },
  exec: async (sql) => {
    return pool.query(sql);
  }
};

async function initSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT,
      message TEXT,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT,
      email TEXT,
      active INTEGER DEFAULT 1,
      "twoFactorSecret" TEXT,
      "twoFactorEnabled" INTEGER DEFAULT 0,
      "createdAt" TEXT,
      "ldapDn" TEXT,
      "authProvider" TEXT DEFAULT 'local',
      "orgId" TEXT DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT,
      level INTEGER,
      description TEXT,
      permissions TEXT
    );

    CREATE TABLE IF NOT EXISTS db_connections (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      host TEXT,
      port INTEGER,
      "user" TEXT,
      password TEXT,
      database TEXT,
      "orgId" TEXT DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS ssh_connections (
      id TEXT PRIMARY KEY,
      name TEXT,
      host TEXT,
      port INTEGER,
      "user" TEXT,
      password TEXT,
      key TEXT,
      "createdAt" TEXT,
      "orgId" TEXT DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS cloud_credentials (
      id TEXT PRIMARY KEY,
      name TEXT,
      provider TEXT,
      credentials TEXT,
      "createdAt" TEXT,
      "orgId" TEXT DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      name TEXT,
      "keepDaily" INTEGER DEFAULT 7,
      "keepWeekly" INTEGER DEFAULT 4,
      "keepMonthly" INTEGER DEFAULT 12,
      "keepYearly" INTEGER DEFAULT 1,
      "createdAt" TEXT,
      "orgId" TEXT DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      name TEXT,
      source TEXT,
      destination TEXT,
      type TEXT,
      "backupType" TEXT,
      config TEXT,
      status TEXT,
      "createdAt" TEXT,
      "updatedAt" TEXT,
      "startedAt" TEXT,
      "completedAt" TEXT,
      "resultFile" TEXT,
      error TEXT,
      size BIGINT DEFAULT 0,
      "orgId" TEXT DEFAULT 'default',
      "lastValidatedAt" TEXT,
      "validationStatus" TEXT,
      "policyId" TEXT
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT,
      "cronExpression" TEXT,
      "backupId" TEXT,
      enabled INTEGER DEFAULT 1,
      "notifyOn" TEXT,
      description TEXT,
      "createdAt" TEXT,
      "updatedAt" TEXT,
      "lastRunAt" TEXT,
      "orgId" TEXT DEFAULT 'default'
    );

    CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status);
    CREATE INDEX IF NOT EXISTS idx_backups_createdAt ON backups("createdAt");
    CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(type);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status);
    CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      "createdAt" TEXT
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL UNIQUE,
      "userId" TEXT NOT NULL,
      "orgId" TEXT DEFAULT 'default',
      permissions TEXT DEFAULT '{}',
      "lastUsedAt" TEXT,
      "expiresAt" TEXT,
      "createdAt" TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens("tokenHash");

    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT,
      events TEXT DEFAULT '[]',
      retries INTEGER DEFAULT 3,
      active INTEGER DEFAULT 1,
      "orgId" TEXT DEFAULT 'default',
      "createdAt" TEXT
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      "endpointId" TEXT NOT NULL,
      event TEXT NOT NULL,
      status TEXT NOT NULL,
      "statusCode" INTEGER,
      attempt INTEGER DEFAULT 1,
      error TEXT,
      "deliveredAt" TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_wh_deliveries_endpoint ON webhook_deliveries("endpointId");
  `);

  try {
    const existing = await db.get("SELECT id FROM organizations WHERE id = 'default'");
    if (!existing) {
      await db.run('INSERT INTO organizations (id, name, slug, "createdAt") VALUES (?, ?, ?, ?)', 
        ['default', 'Default Organization', 'default', new Date().toISOString()]);
    }
  } catch (e) {
    console.error('Failed to seed default organization:', e.message);
  }

  try {
    await db.exec('ALTER TABLE backups ADD COLUMN "lastValidatedAt" TEXT;');
    await db.exec('ALTER TABLE backups ADD COLUMN "validationStatus" TEXT;');
    await db.exec('ALTER TABLE backups ADD COLUMN "policyId" TEXT;');
  } catch(e) {
    // Columns probably exist already
  }

  try {
    const existingPolicy = await db.get("SELECT id FROM policies WHERE id = 'default'");
    if (!existingPolicy) {
      await db.run('INSERT INTO policies (id, name, "keepDaily", "keepWeekly", "keepMonthly", "keepYearly", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)', 
        ['default', 'Standard GFS Retention', 7, 4, 12, 1, new Date().toISOString()]);
    }
  } catch (e) {
    console.error('Failed to seed default policy:', e.message);
  }
}

async function migrate(jsonPath) {
  if (!fs.existsSync(jsonPath)) return;
  
  console.log('JSON migration is skipped in Postgres mode. Please manually import data.');
}

async function closePool() {
  await pool.end();
}

module.exports = { db, initSchema, migrate, closePool };
