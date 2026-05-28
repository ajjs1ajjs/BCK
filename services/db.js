const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../data/bck.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize schema
db.exec(`
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
    createdAt TEXT
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
    user TEXT,
    password TEXT,
    database TEXT
  );

  CREATE TABLE IF NOT EXISTS ssh_connections (
    id TEXT PRIMARY KEY,
    name TEXT,
    host TEXT,
    port INTEGER,
    user TEXT,
    password TEXT,
    key TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS cloud_credentials (
    id TEXT PRIMARY KEY,
    name TEXT,
    provider TEXT,
    credentials TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    name TEXT,
    source TEXT,
    destination TEXT,
    type TEXT,
    backupType TEXT,
    config TEXT,
    status TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    startedAt TEXT,
    completedAt TEXT,
    resultFile TEXT,
    error TEXT,
    size INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT,
    cronExpression TEXT,
    backupId TEXT,
    enabled INTEGER DEFAULT 1,
    notifyOn TEXT,
    description TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );
`);

// Migration from db.json
function migrate(jsonPath) {
  if (!fs.existsSync(jsonPath)) return;
  
  console.log(`Migrating data from ${jsonPath}...`);
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    db.transaction(() => {
      // Migrate settings
      if (data.settings) {
        for (const [key, val] of Object.entries(data.settings)) {
           db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(val));
        }
      }

      // Migrate roles
      if (data.roles) {
        const insert = db.prepare('INSERT OR REPLACE INTO roles (id, name, level, description, permissions) VALUES (?, ?, ?, ?, ?)');
        for (const r of data.roles) {
          insert.run(r.id, r.name, r.level || 0, r.description || '', JSON.stringify(r.permissions));
        }
      }

      // Migrate users
      if (data.users) {
        const insert = db.prepare('INSERT OR REPLACE INTO users (id, username, password, role, email, active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const u of data.users) {
          insert.run(u.id, u.username, u.password || '', u.role, u.email || '', u.active ? 1 : 0, u.createdAt || new Date().toISOString());
        }
      }

      // Migrate logs
      if (data.logs) {
        const insert = db.prepare('INSERT OR REPLACE INTO logs (id, timestamp, message, status) VALUES (?, ?, ?, ?)');
        for (const l of data.logs) {
          insert.run(l.id, l.timestamp, l.message, l.status);
        }
      }

      // Migrate dbConnections
      if (data.dbConnections) {
        const insert = db.prepare('INSERT OR REPLACE INTO db_connections (id, name, type, host, port, user, password, database) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const c of data.dbConnections) {
          insert.run(c.id, c.name, c.type, c.host, c.port || 0, c.user, c.password || '', c.database || '');
        }
      }

      // Migrate sshConnections
      if (data.sshConnections) {
        const insert = db.prepare('INSERT OR REPLACE INTO ssh_connections (id, name, host, port, user, password, key, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const c of data.sshConnections) {
          insert.run(c.id, c.name, c.host, c.port || 22, c.user, c.password || '', c.key || '', c.createdAt || new Date().toISOString());
        }
      }

      // Migrate cloudCredentials
      if (data.cloudCredentials) {
        const insert = db.prepare('INSERT OR REPLACE INTO cloud_credentials (id, name, provider, credentials, createdAt) VALUES (?, ?, ?, ?, ?)');
        for (const c of data.cloudCredentials) {
          insert.run(c.id, c.name, c.provider, JSON.stringify(c.credentials), c.createdAt || new Date().toISOString());
        }
      }

      // Migrate backups
      if (data.backups) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO backups 
          (id, name, source, destination, type, backupType, config, status, createdAt, updatedAt, startedAt, completedAt, resultFile, error, size) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const b of data.backups) {
          insert.run(b.id, b.name, b.source || '', b.destination || '', b.type || 'full', b.backupType || 'files', JSON.stringify(b.config || {}), b.status || 'pending', b.createdAt || new Date().toISOString(), b.updatedAt || new Date().toISOString(), b.startedAt || null, b.completedAt || null, b.resultFile || null, b.error || null, b.size || 0);
        }
      }

      // Migrate schedules
      if (data.schedules) {
        const insert = db.prepare('INSERT OR REPLACE INTO schedules (id, name, cronExpression, backupId, enabled, notifyOn, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const s of data.schedules) {
          insert.run(s.id, s.name, s.cronExpression || s.cron || '', s.backupId, s.enabled ? 1 : 0, s.notifyOn || 'failure', s.description || '', s.createdAt || new Date().toISOString(), s.updatedAt || new Date().toISOString());
        }
      }
    })();

    console.log('Migration successful.');
    fs.renameSync(jsonPath, jsonPath + '.bak');
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
}

module.exports = { db, migrate };
