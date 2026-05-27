const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const dbService = require('./services/database');
const vmService = require('./services/vm');
const cloudService = require('./services/cloud');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bck-default-secret-change-me';
const SALT_ROUNDS = 10;
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'db.json'));

// ─── Security middleware ────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '50mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, try again later' },
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, try again later' },
});

const defaultData = {
  backups: [],
  schedules: [],
  logs: [],
  dbConnections: [],
  cloudCredentials: [],
  users: [
    { id: 'admin', username: 'admin', role: 'admin', email: 'admin@bck.local', active: true, createdAt: new Date().toISOString() },
    { id: 'operator', username: 'operator', role: 'operator', email: 'operator@bck.local', active: true, createdAt: new Date().toISOString() },
    { id: 'viewer', username: 'viewer', role: 'viewer', email: 'viewer@bck.local', active: true, createdAt: new Date().toISOString() },
  ],
  roles: [
    {
      id: 'admin', name: 'Admin', level: 100, description: 'Full system access',
      permissions: { manageUsers: true, manageBackups: true, manageSchedules: true, restore: true, delete: true, configure: true, viewLogs: true, manageRoles: true },
    },
    {
      id: 'operator', name: 'Operator', level: 50, description: 'Manage backups and schedules',
      permissions: { manageUsers: false, manageBackups: true, manageSchedules: true, restore: true, delete: false, configure: false, viewLogs: true, manageRoles: false },
    },
    {
      id: 'viewer', name: 'Viewer', level: 10, description: 'Read-only access',
      permissions: { manageUsers: false, manageBackups: false, manageSchedules: false, restore: false, delete: false, configure: false, viewLogs: true, manageRoles: false },
    },
  ],
  settings: {
    smtp: { host: '', port: 587, user: '', password: '', from: '', encryption: 'tls' },
    retention: { enabled: true, days: 30, copies: 10 },
    notifications: { email: false, emailOnSuccess: false, slack: '', discord: '', telegram: '', telegramBotToken: '', webhook: '' },
    schedule: { timezone: 'UTC' },
  },
  stats: { totalBackups: 0, successfulBackups: 0, failedBackups: 0, totalSize: 0, lastBackup: null },
};

const DEFAULT_PASSWORDS = { admin: '291263', operator: 'operator', viewer: 'viewer' };

// ─── DB helpers ─────────────────────────────────────────────────────────────

const initDB = async () => {
  try {
    await fs.access(DB_PATH);
    const existing = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
    // Merge missing collections
    if (!existing.users || !existing.roles) {
      Object.assign(existing, { users: existing.users || defaultData.users, roles: existing.roles || defaultData.roles });
      // Hash passwords in existing data if plain text
      for (const user of existing.users) {
        if (user.password && !user.password.startsWith('$2a$') && !user.password.startsWith('$2b$')) {
          user.password = await bcrypt.hash(user.password, SALT_ROUNDS);
        }
      }
      await fs.writeFile(DB_PATH, JSON.stringify(existing, null, 2));
    }
  } catch {
    // Hash default passwords when creating fresh DB
    const hashedUsers = await Promise.all(defaultData.users.map(async u => ({
      ...u, password: await bcrypt.hash(DEFAULT_PASSWORDS[u.username] || 'changeme', SALT_ROUNDS),
    })));
    await fs.writeFile(DB_PATH, JSON.stringify({ ...defaultData, users: hashedUsers }, null, 2));
  }
};

const readDB = async () => {
  try { return JSON.parse(await fs.readFile(DB_PATH, 'utf8')); }
  catch { return null; }
};

const writeDB = async (data) => {
  try { await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2)); return true; }
  catch { return false; }
};

const addLog = async (message, status = 'info') => {
  const db = await readDB();
  if (!db) return;
  db.logs.unshift({ id: uuidv4(), timestamp: new Date().toISOString(), message, status });
  if (db.logs.length > 500) db.logs.length = 500;
  await writeDB(db);
};

const updateStats = async (db) => {
  const total = db.backups.length;
  const success = db.backups.filter(b => b.status === 'completed').length;
  const failed = db.backups.filter(b => b.status === 'failed').length;
  const last = db.backups.filter(b => b.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
  db.stats = { totalBackups: total, successfulBackups: success, failedBackups: failed, totalSize: db.stats?.totalSize || 0, lastBackup: last?.completedAt || null };
};

// ─── Backups CRUD ───────────────────────────────────────────────────────────

app.get('/api/backups', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const { type } = req.query;
  let items = db.backups;
  if (type) items = items.filter(b => b.backupType === type || b.type === type);
  res.json(items);
});

app.post('/api/backups', async (req, res) => {
  const { name, source, destination, type, backupType, config } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const backup = {
    id: uuidv4(), name, source, destination,
    type: type || 'full', backupType: backupType || 'files',
    config: config || {},
    status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.backups.push(backup);
  if (await writeDB(db)) {
    await addLog(`Created backup: ${name} [${backupType}]`, 'success');
    res.status(201).json(backup);
  } else res.status(500).json({ error: 'Failed to save' });
});

app.get('/api/backups/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const b = db.backups.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});

app.put('/api/backups/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.backups.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.backups[idx] = { ...db.backups[idx], ...req.body, updatedAt: new Date().toISOString() };
  if (await writeDB(db)) {
    await addLog(`Updated backup: ${db.backups[idx].name}`, 'success');
    res.json(db.backups[idx]);
  } else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/backups/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.backups.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [deleted] = db.backups.splice(idx, 1);
  await updateStats(db);
  if (await writeDB(db)) {
    await addLog(`Deleted backup: ${deleted.name}`, 'success');
    res.json({ message: 'Deleted' });
  } else res.status(500).json({ error: 'Failed to delete' });
});

// ─── Backup Execution ───────────────────────────────────────────────────────

app.post('/api/backups/:id/run', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.backups.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const job = db.backups[idx];
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  await writeDB(db);

  res.json({ message: `Backup ${job.name} started`, id: job.id });

  // Run async
  try {
    let result;
    const backupType = job.backupType || job.type;

    if (['mysql', 'postgres', 'oracle'].includes(backupType)) {
      const conn = db.dbConnections.find(c => c.id === job.config?.connectionId);
      result = await dbService.backup({
        type: backupType, connection: conn || job.config, backupPath: job.destination, name: job.name,
      });
    } else if (['vmware', 'hyperv'].includes(backupType)) {
      result = await vmService.backup({
        type: backupType, vmName: job.config?.vmName || job.name,
        host: job.config?.host, user: job.config?.user, password: job.config?.password,
        datastore: job.config?.datastore, backupPath: job.destination,
      });
    } else {
      result = { success: true, file: job.destination, error: null };
    }

    const db2 = await readDB();
    const idx2 = db2.backups.findIndex(x => x.id === req.params.id);
    if (idx2 !== -1) {
      db2.backups[idx2].status = result.success ? 'completed' : 'failed';
      db2.backups[idx2].completedAt = new Date().toISOString();
      db2.backups[idx2].resultFile = result.file || null;
      db2.backups[idx2].error = result.error || null;
      if (result.size) db2.stats.totalSize = (db2.stats.totalSize || 0) + result.size;
      await updateStats(db2);
      await writeDB(db2);
      await addLog(
        result.success ? `Backup completed: ${job.name}` : `Backup failed: ${job.name} - ${result.error}`,
        result.success ? 'success' : 'error'
      );
    }
  } catch (e) {
    const db3 = await readDB();
    const idx3 = db3.backups.findIndex(x => x.id === req.params.id);
    if (idx3 !== -1) {
      db3.backups[idx3].status = 'failed';
      db3.backups[idx3].error = e.message;
      await writeDB(db3);
      await addLog(`Backup error: ${job.name} - ${e.message}`, 'error');
    }
  }
});

// ─── Restore ────────────────────────────────────────────────────────────────

app.post('/api/restore', async (req, res) => {
  const { backupId, targetType, config } = req.body;
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });

  const job = db.backups.find(b => b.id === backupId);
  if (!job) return res.status(404).json({ error: 'Backup not found' });

  await addLog(`Restore started: ${job.name}`, 'info');
  res.json({ message: `Restore of ${job.name} initiated` });

  try {
    let result;
    const backupType = job.backupType || job.type;

    if (['mysql', 'postgres', 'oracle'].includes(backupType)) {
      const conn = db.dbConnections.find(c => c.id === config?.connectionId);
      result = await dbService.restore({
        type: backupType, connection: conn || config, file: job.resultFile || config?.file,
      });
    } else if (['vmware', 'hyperv'].includes(backupType)) {
      result = await vmService.restore({
        type: backupType, vmName: config?.vmName || job.name + '-restored',
        host: config?.host, user: config?.user, password: config?.password,
        file: job.resultFile,
      });
    } else {
      result = { success: true };
    }

    await addLog(
      result.success ? `Restore completed: ${job.name}` : `Restore failed: ${job.name} - ${result.error}`,
      result.success ? 'success' : 'error'
    );
  } catch (e) {
    await addLog(`Restore error: ${job.name} - ${e.message}`, 'error');
  }
});

// ─── Database Connections ───────────────────────────────────────────────────

app.get('/api/db-connections', async (req, res) => {
  const db = await readDB();
  res.json(db?.dbConnections || []);
});

app.post('/api/db-connections', async (req, res) => {
  const { name, type, host, port, user, password, database } = req.body;
  if (!name || !type || !host || !user) return res.status(400).json({ error: 'Name, type, host, user required' });
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const conn = { id: uuidv4(), name, type, host, port: port || 3306, user, password: password || '', database: database || '' };
  db.dbConnections.push(conn);
  if (await writeDB(db)) {
    res.status(201).json({ ...conn, password: '***' });
  } else res.status(500).json({ error: 'Failed to save' });
});

app.put('/api/db-connections/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.dbConnections.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { password, ...rest } = req.body;
  db.dbConnections[idx] = { ...db.dbConnections[idx], ...rest };
  if (password && password !== '***') db.dbConnections[idx].password = password;
  if (await writeDB(db)) {
    res.json({ ...db.dbConnections[idx], password: '***' });
  } else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/db-connections/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.dbConnections.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.dbConnections.splice(idx, 1);
  if (await writeDB(db)) res.json({ message: 'Deleted' });
  else res.status(500).json({ error: 'Failed to delete' });
});

app.post('/api/db-connections/:id/test', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const conn = db.dbConnections.find(c => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  const dbs = dbService.listDatabases(conn.type, conn);
  res.json({ success: dbs.length > 0, databases: dbs });
});

app.get('/api/db-connections/:id/databases', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const conn = db.dbConnections.find(c => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  const dbs = dbService.listDatabases(conn.type, conn);
  res.json(dbs);
});

// ─── Cloud Credentials ──────────────────────────────────────────────────────

app.get('/api/cloud-credentials', async (req, res) => {
  const db = await readDB();
  res.json(db?.cloudCredentials?.map(c => ({ ...c, credentials: { ...c.credentials, secretAccessKey: '***', accessKey: '***', password: '***' } })) || []);
});

app.post('/api/cloud-credentials', async (req, res) => {
  const { name, provider, credentials } = req.body;
  if (!name || !provider || !credentials) return res.status(400).json({ error: 'Name, provider, credentials required' });
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const cred = { id: uuidv4(), name, provider, credentials, createdAt: new Date().toISOString() };
  db.cloudCredentials.push(cred);
  if (await writeDB(db)) {
    await addLog(`Cloud credentials added: ${name} [${provider}]`, 'success');
    res.status(201).json({ ...cred, credentials: { ...credentials, secretAccessKey: '***', accessKey: '***', password: '***' } });
  } else res.status(500).json({ error: 'Failed to save' });
});

app.put('/api/cloud-credentials/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.cloudCredentials.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { credentials } = req.body;
  const curr = db.cloudCredentials[idx];
  if (credentials) {
    const merged = { ...curr.credentials };
    for (const [k, v] of Object.entries(credentials)) {
      if (v !== '***') merged[k] = v;
    }
    curr.credentials = merged;
  }
  if (req.body.name) curr.name = req.body.name;
  if (await writeDB(db)) res.json({ ...curr, credentials: { ...curr.credentials, secretAccessKey: '***', accessKey: '***', password: '***' } });
  else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/cloud-credentials/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.cloudCredentials.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.cloudCredentials.splice(idx, 1);
  if (await writeDB(db)) res.json({ message: 'Deleted' });
  else res.status(500).json({ error: 'Failed to delete' });
});

app.post('/api/cloud-credentials/:id/test', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const cred = db.cloudCredentials.find(c => c.id === req.params.id);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  const toolCheck = cloudService.checkTools(cred.provider);
  if (!toolCheck.available) return res.json({ success: false, error: `${cred.provider} CLI not installed` });
  try {
    const result = await cloudService.list({ provider: cred.provider, credentials: cred.credentials }, '');
    res.json({ success: true, message: `Connected. Found ${result.length} objects.` });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ─── Tools check ────────────────────────────────────────────────────────────

app.get('/api/tools', async (req, res) => {
  const tools = {
    mysql: dbService.checkTools('mysql'),
    postgres: dbService.checkTools('postgres'),
    oracle: dbService.checkTools('oracle'),
    vmware: vmService.checkTools('vmware'),
    hyperv: vmService.checkTools('hyperv'),
    aws: cloudService.checkTools('aws'),
    azure: cloudService.checkTools('azure'),
    gcp: cloudService.checkTools('gcp'),
  };
  res.json(tools);
});

// ─── Schedules ──────────────────────────────────────────────────────────────

app.get('/api/schedules', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  res.json(db.schedules);
});

app.post('/api/schedules', async (req, res) => {
  const { name, cronExpression, backupId } = req.body;
  if (!name || !cronExpression || !backupId) return res.status(400).json({ error: 'Name, cron, backupId required' });
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const schedule = { id: uuidv4(), name, cronExpression, backupId, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.schedules.push(schedule);
  if (await writeDB(db)) {
    await addLog(`Schedule created: ${name}`, 'success');
    res.status(201).json(schedule);
  } else res.status(500).json({ error: 'Failed to save' });
});

app.put('/api/schedules/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.schedules[idx] = { ...db.schedules[idx], ...req.body, updatedAt: new Date().toISOString() };
  if (await writeDB(db)) res.json(db.schedules[idx]);
  else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/schedules/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.schedules.splice(idx, 1);
  if (await writeDB(db)) res.json({ message: 'Deleted' });
  else res.status(500).json({ error: 'Failed to delete' });
});

// ─── Logs, Stats, Settings ──────────────────────────────────────────────────

app.get('/api/logs', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const { level, limit: qLimit } = req.query;
  let items = db.logs;
  if (level) items = items.filter(l => l.status === level);
  if (qLimit) items = items.slice(0, parseInt(qLimit));
  res.json(items);
});

app.get('/api/stats', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  await updateStats(db);
  res.json(db.stats);
});

app.get('/api/settings', async (req, res) => {
  const db = await readDB();
  res.json(db?.settings || defaultData.settings);
});

app.put('/api/settings', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  db.settings = { ...db.settings, ...req.body };
  if (await writeDB(db)) {
    await addLog('Settings updated', 'info');
    res.json(db.settings);
  } else res.status(500).json({ error: 'Failed to save' });
});

// ─── Users ──────────────────────────────────────────────────────────────────

app.get('/api/users', async (req, res) => {
  const db = await readDB();
  const safe = (db?.users || []).map(u => ({ ...u, password: '***' }));
  res.json(safe);
});

app.post('/api/users', async (req, res) => {
  const { username, password, role, email } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Username, password, role required' });
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  if (db.users.find(u => u.username === username)) return res.status(400).json({ error: 'Username exists' });
  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { id: uuidv4(), username, password: hashed, role, email: email || '', active: true, createdAt: new Date().toISOString() };
  db.users.push(user);
  if (await writeDB(db)) {
    await addLog(`User created: ${username}`, 'success');
    res.status(201).json({ ...user, password: '***' });
  } else res.status(500).json({ error: 'Failed to save' });
});

app.put('/api/users/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { password, ...rest } = req.body;
  if (password && password !== '***') db.users[idx].password = await bcrypt.hash(password, SALT_ROUNDS);
  Object.assign(db.users[idx], rest);
  if (await writeDB(db)) {
    await addLog(`User updated: ${db.users[idx].username}`, 'info');
    res.json({ ...db.users[idx], password: '***' });
  } else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/users/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [deleted] = db.users.splice(idx, 1);
  if (await writeDB(db)) {
    await addLog(`User deleted: ${deleted.username}`, 'warning');
    res.json({ message: 'Deleted' });
  } else res.status(500).json({ error: 'Failed to delete' });
});

// ─── Roles ──────────────────────────────────────────────────────────────────

app.get('/api/roles', async (req, res) => {
  const db = await readDB();
  res.json(db?.roles || []);
});

app.post('/api/roles', async (req, res) => {
  const { name, description, permissions } = req.body;
  if (!name || !permissions) return res.status(400).json({ error: 'Name and permissions required' });
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const role = { id: uuidv4(), name, description: description || '', level: 1, permissions };
  db.roles.push(role);
  if (await writeDB(db)) {
    await addLog(`Role created: ${name}`, 'success');
    res.status(201).json(role);
  } else res.status(500).json({ error: 'Failed to save' });
});

app.put('/api/roles/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.roles.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  Object.assign(db.roles[idx], req.body);
  if (await writeDB(db)) {
    await addLog(`Role updated: ${db.roles[idx].name}`, 'info');
    res.json(db.roles[idx]);
  } else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/roles/:id', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.roles.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [deleted] = db.roles.splice(idx, 1);
  if (await writeDB(db)) {
    await addLog(`Role deleted: ${deleted.name}`, 'warning');
    res.json({ message: 'Deleted' });
  } else res.status(500).json({ error: 'Failed to delete' });
});

// ─── Auth middleware ─────────────────────────────────────────────────────────

const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
};

// Public routes (no auth)
app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const db = await readDB();
  const user = db?.users?.find(u => u.username === username && u.active !== false);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const role = db?.roles?.find(r => r.id === user.role);
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, permissions: role?.permissions || {} },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ token, username: user.username, role: user.role, permissions: role?.permissions || {} });
});

// All /api/* routes below require authentication
app.use('/api/', authenticate);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ─── Frontend ───────────────────────────────────────────────────────────────

const buildPath = path.join(__dirname, 'frontend', 'build');
fs.access(buildPath).then(() => {
  app.use(express.static(buildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}).catch(() => {
  console.log('No production build found — API only');
});

// ─── Start ──────────────────────────────────────────────────────────────────

const start = async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`BCK server running on http://localhost:${PORT}`);
  });
};

start();

module.exports = app;
