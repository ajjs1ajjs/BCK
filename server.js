const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const dbService = require('./services/database');
const vmService = require('./services/vm');
const cloudService = require('./services/cloud');
const hostService = require('./services/host');
const sshService = require('./services/ssh');

const app = express();
const PORT = process.env.PORT || 9000;
const HOST = process.env.HOST || '0.0.0.0';
const APP_URL = process.env.APP_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || 'bck-default-secret-change-me';
const SALT_ROUNDS = 10;
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'db.json'));

const getLocalIp = () => {
  const interfaces = os.networkInterfaces();
  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return '127.0.0.1';
};

const buildDefaultAppUrl = () => APP_URL || `http://${getLocalIp()}:${PORT}`;

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
  sshConnections: [],
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
    retention: { enabled: true, days: 30, copies: 10, customLimitEnabled: false, customLimitGB: 50 },
    notifications: { email: false, emailOnSuccess: false, slack: '', discord: '', telegram: '', telegramBotToken: '', webhook: '' },
    schedule: { timezone: 'UTC' },
    security: { sessionTimeout: 60, preventConcurrent: false, minPasswordLength: 6 },
    advanced: { tempPath: '', bandwidthLimit: 0, compressionLevel: 'medium' },
    network: { appUrl: APP_URL, bindHost: HOST },
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
      for (const user of existing.users) {
        if (user.password && !user.password.startsWith('$2a$') && !user.password.startsWith('$2b$')) {
          user.password = await bcrypt.hash(user.password, SALT_ROUNDS);
        }
      }
      await fs.writeFile(DB_PATH, JSON.stringify(existing, null, 2));
    } else if (!existing.sshConnections) {
      existing.sshConnections = [];
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

// Queue database writes to prevent race conditions and data corruption
let writeQueue = Promise.resolve();
const writeDB = async (data) => {
  return new Promise((resolve) => {
    writeQueue = writeQueue.then(async () => {
      try {
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
        resolve(true);
      } catch (err) {
        console.error('Database write error:', err);
        resolve(false);
      }
    });
  });
});

// ─── SSH Connections ────────────────────────────────────────────────────

app.get('/api/ssh-connections', async (req, res) => {
  const db = await readDB();
  const safe = (db?.sshConnections || []).map(c => ({ ...c, password: c.password ? '***' : '' }));
  res.json(safe);
});

app.post('/api/ssh-connections', authorize('manageBackups'), async (req, res) => {
  const { name, host, port, user, password, key } = req.body;
  if (!name || !host || !user) return res.status(400).json({ error: 'Name, host, user required' });
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const conn = { id: uuidv4(), name, host, port: port || 22, user, password: password || '', key: key || '', createdAt: new Date().toISOString() };
  db.sshConnections.push(conn);
  if (await writeDB(db)) {
    await addLog(`SSH connection added: ${name}`, 'success');
    res.status(201).json({ ...conn, password: '***' });
  } else res.status(500).json({ error: 'Failed to save' });
});

app.put('/api/ssh-connections/:id', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.sshConnections.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { password, ...rest } = req.body;
  db.sshConnections[idx] = { ...db.sshConnections[idx], ...rest };
  if (password && password !== '***') db.sshConnections[idx].password = password;
  if (await writeDB(db)) {
    await addLog(`SSH connection updated: ${db.sshConnections[idx].name}`, 'info');
    res.json({ ...db.sshConnections[idx], password: '***' });
  } else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/ssh-connections/:id', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.sshConnections.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.sshConnections.splice(idx, 1);
  if (await writeDB(db)) res.json({ message: 'Deleted' });
  else res.status(500).json({ error: 'Failed to delete' });
});

app.post('/api/ssh-connections/:id/test', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const conn = db.sshConnections.find(c => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  try {
    const r = await sshService.exec(conn, 'echo BCK_CONNECTED && hostname');
    res.json({ success: r.success, hostname: r.stdout || null, error: r.stderr || null });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ─── Cloud Credentials ──────────────────────────────────────────────────

app.get('/api/cloud-credentials', async (req, res) => {
  const db = await readDB();
  res.json(db?.cloudCredentials?.map(c => ({ ...c, credentials: { ...c.credentials, secretAccessKey: '***', accessKey: '***', password: '***' } })) || []);
});

app.post('/api/cloud-credentials', authorize('manageBackups'), async (req, res) => {
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

app.put('/api/cloud-credentials/:id', authorize('manageBackups'), async (req, res) => {
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

app.delete('/api/cloud-credentials/:id', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.cloudCredentials.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.cloudCredentials.splice(idx, 1);
  if (await writeDB(db)) res.json({ message: 'Deleted' });
  else res.status(500).json({ error: 'Failed to delete' });
});

app.post('/api/cloud-credentials/:id/test', authorize('manageBackups'), async (req, res) => {
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
    ssh: sshService.checkTools(),
  };
  res.json(tools);
});

// ─── Schedules ──────────────────────────────────────────────────────────────

app.get('/api/schedules', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  res.json(db.schedules);
});

app.post('/api/schedules', authorize('manageSchedules'), async (req, res) => {
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

app.put('/api/schedules/:id', authorize('manageSchedules'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.schedules[idx] = { ...db.schedules[idx], ...req.body, updatedAt: new Date().toISOString() };
  if (await writeDB(db)) res.json(db.schedules[idx]);
  else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/schedules/:id', authorize('manageSchedules'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.schedules.splice(idx, 1);
  if (await writeDB(db)) res.json({ message: 'Deleted' });
  else res.status(500).json({ error: 'Failed to delete' });
});

// ─── Logs, Stats, Settings ──────────────────────────────────────────────────

app.get('/api/logs', authorize('viewLogs'), async (req, res) => {
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
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const settings = getSettings(db);
  const safe = {
    ...settings,
    smtp: {
      ...settings.smtp,
      password: settings.smtp?.password ? '***' : '',
    },
    network: {
      ...settings.network,
      localIp: getLocalIp(),
      effectiveAppUrl: settings.network?.appUrl || buildDefaultAppUrl(),
    },
  };
  res.json(safe);
});

app.put('/api/settings', authorize('configure'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const body = req.body;
  const current = getSettings(db);

  const merged = {
    smtp: { ...current.smtp, ...(body.smtp || {}) },
    retention: { ...current.retention, ...(body.retention || {}) },
    notifications: { ...current.notifications, ...(body.notifications || {}) },
    schedule: { ...current.schedule, ...(body.schedule || {}) },
    security: { ...current.security, ...(body.security || {}) },
    advanced: { ...current.advanced, ...(body.advanced || {}) },
    network: {
      ...current.network,
      appUrl: body.network?.appUrl ?? current.network.appUrl,
      bindHost: body.network?.bindHost ?? current.network.bindHost,
    },
  };

  if (body.smtp && body.smtp.password === '***') {
    merged.smtp.password = db.settings?.smtp?.password || '';
  }

  db.settings = merged;
  if (await writeDB(db)) {
    await addLog('Settings updated', 'info');
    const safe = {
      ...db.settings,
      smtp: {
        ...db.settings.smtp,
        password: db.settings.smtp?.password ? '***' : '',
      },
      network: {
        ...db.settings.network,
        localIp: getLocalIp(),
        effectiveAppUrl: db.settings.network?.appUrl || buildDefaultAppUrl(),
      },
    };
    res.json(safe);
  } else res.status(500).json({ error: 'Failed to save' });
});

// ─── Users ──────────────────────────────────────────────────────────────────

app.get('/api/users', authorize('manageUsers'), async (req, res) => {
  const db = await readDB();
  const safe = (db?.users || []).map(u => ({ ...u, password: '***' }));
  res.json(safe);
});

app.post('/api/users', authorize('manageUsers'), async (req, res) => {
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

app.put('/api/users/:id', authorize('manageUsers'), async (req, res) => {
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

app.delete('/api/users/:id', authorize('manageUsers'), async (req, res) => {
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

app.get('/api/roles', authorize('manageRoles'), async (req, res) => {
  const db = await readDB();
  res.json(db?.roles || []);
});

app.post('/api/roles', authorize('manageRoles'), async (req, res) => {
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

app.put('/api/roles/:id', authorize('manageRoles'), async (req, res) => {
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

app.delete('/api/roles/:id', authorize('manageRoles'), async (req, res) => {
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
  app.listen(PORT, HOST, () => {
    console.log(`BCK server running on ${buildDefaultAppUrl()}`);
  });
};

start();

module.exports = app;
