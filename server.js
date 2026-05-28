const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { z } = require('zod');

const dbService = require('./services/database');
const vmService = require('./services/vm');
const cloudService = require('./services/cloud');
const hostService = require('./services/host');
const sshService = require('./services/ssh');

const app = express();
const PORT = process.env.PORT || 9000;
const HOST = process.env.HOST || '0.0.0.0';
const APP_URL = process.env.APP_URL || '';
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: No JWT_SECRET set. Using a random secret — logins will be invalid after restart.');
  console.warn('Set JWT_SECRET in .env for persistent authentication.');
}
const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex');
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
  origin: process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

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

// ─── Validation helper ───────────────────────────────────────────────────────

function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return { valid: false, errors };
  }
  return { valid: true, data: result.data };
}

const schemas = {
  login: z.object({
    username: z.string().min(1).max(50),
    password: z.string().min(1).max(200),
  }),
  createUser: z.object({
    username: z.string().min(2).max(50).regex(/^[a-zA-Z0-9_-]+$/),
    password: z.string().min(4).max(200),
    role: z.string().min(1).max(50),
    email: z.string().email().optional().or(z.literal('')),
  }),
  createBackup: z.object({
    name: z.string().min(1).max(200),
    source: z.string().max(1000).optional(),
    destination: z.string().max(1000).optional(),
    type: z.string().max(50).optional(),
    backupType: z.string().max(50).optional(),
    config: z.any().optional(),
  }),
  createSchedule: z.object({
    name: z.string().min(1).max(200),
    cronExpression: z.string().min(1).max(100),
    backupId: z.string().min(1).max(100),
  }),
  dbConnection: z.object({
    name: z.string().min(1).max(200),
    type: z.enum(['mysql', 'postgres', 'oracle']),
    host: z.string().min(1).max(500),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(200),
    password: z.string().max(2000).optional(),
    database: z.string().max(200).optional(),
  }),
  sshConnection: z.object({
    name: z.string().min(1).max(200),
    host: z.string().min(1).max(500),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(200),
    password: z.string().max(2000).optional(),
    key: z.string().max(50000).optional(),
  }),
  cloudCredential: z.object({
    name: z.string().min(1).max(200),
    provider: z.enum(['aws', 'azure', 'gcp']),
    credentials: z.record(z.any()),
  }),
  settings: z.object({
    smtp: z.any().optional(),
    retention: z.any().optional(),
    notifications: z.any().optional(),
    schedule: z.any().optional(),
    security: z.any().optional(),
    advanced: z.any().optional(),
    network: z.any().optional(),
  }),
};

// ─── Auth middlewares ──────────────────────────────────────────
const authenticate = (req, res, next) => {
  const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
};

const authorize = (permission) => {
  return (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.permissions?.[permission])) {
      return next();
    }
    return res.status(403).json({ error: `Forbidden: requires ${permission} permission` });
  };
};

const addLog = async (message, status = 'info') => {
  const db = await readDB();
  if (!db) return;
  db.logs.unshift({ id: uuidv4(), timestamp: new Date().toISOString(), message, status });
  if (db.logs.length > 500) db.logs.length = 500;
  await writeDB(db);
};

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

const SSH_KEYS_DIR = path.join(__dirname, 'data', 'ssh_keys');

// ─── Helpers ──────────────────────────────────────────────────────────────

function writeSshKey(id, keyContent) {
  if (!keyContent) return '';
  const dir = SSH_KEYS_DIR;
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, `${id}.pem`);
  fsSync.writeFileSync(keyPath, keyContent, 'utf8');
  fsSync.chmodSync(keyPath, 0o600);
  return keyPath;
}

function readSshKey(keyPath) {
  if (!keyPath) return '';
  try { return fsSync.readFileSync(keyPath, 'utf8'); } catch { return ''; }
}

function deleteSshKey(keyPath) {
  if (!keyPath) return;
  try { fsSync.unlinkSync(keyPath); } catch (e) { console.error('Failed to delete SSH key:', e.message); }
}

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
};

// ─── Helpers ──────────────────────────────────────────────────────────

const updateStats = async (db) => {
  const total = db.backups.length;
  const success = db.backups.filter(b => b.status === 'completed').length;
  const failed = db.backups.filter(b => b.status === 'failed').length;
  const last = db.backups.filter(b => b.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
  db.stats = {
    totalBackups: total,
    successfulBackups: success,
    failedBackups: failed,
    totalSize: db.stats?.totalSize || 0,
    lastBackup: last?.completedAt || null,
    diskSpace: db.stats?.diskSpace || { totalBytes: 0, freeBytes: 0, usedBytes: 0, isQuota: false },
    diskSpaces: db.stats?.diskSpaces || [],
    cloudSpaces: db.stats?.cloudSpaces || [],
  };
};

const getSettings = (db) => {
  const current = db.settings || {};
  const defaults = defaultData.settings;
  return {
    smtp: { ...defaults.smtp, ...(current.smtp || {}) },
    retention: { ...defaults.retention, ...(current.retention || {}) },
    notifications: { ...defaults.notifications, ...(current.notifications || {}) },
    schedule: { ...defaults.schedule, ...(current.schedule || {}) },
    security: { ...defaults.security, ...(current.security || {}) },
    advanced: { ...defaults.advanced, ...(current.advanced || {}) },
    network: { ...defaults.network, ...(current.network || {}) },
  };
};

// ─── Authentication ─────────────────────────────────────────────────────────

app.post('/api/login', authLimiter, async (req, res) => {
  const v = validate(schemas.login, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { username, password } = v.data;
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
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.json({ token, username: user.username, role: user.role, permissions: role?.permissions || {} });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.use('/api/', authenticate);

// ─── Backups CRUD ───────────────────────────────────────────────────────────

app.get('/api/backups', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const { type } = req.query;
  let items = db.backups;
  if (type) items = items.filter(b => b.backupType === type || b.type === type);
  res.json(items);
});

app.post('/api/backups', authorize('manageBackups'), async (req, res) => {
  const v = validate(schemas.createBackup, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, source, destination, type, backupType, config } = v.data;
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

app.put('/api/backups/:id', authorize('manageBackups'), async (req, res) => {
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

app.delete('/api/backups/:id', authorize('delete'), async (req, res) => {
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

app.get('/api/vm-backups', async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const vmSources = db.vmBackups || [];
  const vmJobs = db.backups.filter(b => ['vmware', 'hyperv'].includes(b.backupType || b.type));
  res.json([...vmSources, ...vmJobs]);
});

app.post('/api/vm-backups', authorize('manageBackups'), async (req, res) => {
  const { name, type, config } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type required' });
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const vm = {
    id: uuidv4(), name, type: type || 'vmware', config: config || {},
    createdAt: new Date().toISOString(),
  };
  if (!db.vmBackups) db.vmBackups = [];
  db.vmBackups.push(vm);
  if (await writeDB(db)) {
    res.status(201).json(vm);
  } else res.status(500).json({ error: 'Failed to save' });
});

// ─── Backup Execution ───────────────────────────────────────────────────────

app.post('/api/backups/:id/run', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.backups.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const job = db.backups[idx];
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  await writeDB(db);

  res.json({ message: `Backup ${job.name} started`, id: job.id });

  try {
    let result;
    const backupType = job.backupType || job.type;

    if (['mysql', 'postgres', 'oracle'].includes(backupType)) {
      const conn = db.dbConnections.find(c => c.id === job.config?.connectionId);
      result = await dbService.backup({
        type: backupType, connection: conn || job.config, backupPath: job.destination, name: job.name,
      });
      if (result.success && job.config?.cloudCredentialId) {
        const cred = db.cloudCredentials.find(c => c.id === job.config.cloudCredentialId);
        if (cred) {
          const uploadRes = await cloudService.upload(cred, result.file, path.basename(result.file));
          if (!uploadRes.success) {
            result.success = false;
            result.error = `Backup succeeded but cloud upload failed: ${uploadRes.error}`;
          }
        }
      }
    } else if (['vmware', 'hyperv'].includes(backupType)) {
      result = await vmService.backup({
        type: backupType, vmName: job.config?.vmName || job.name,
        host: job.config?.host, user: job.config?.user, password: job.config?.password,
        datastore: job.config?.datastore, backupPath: job.destination,
      });
    } else if (backupType === 'host') {
      result = await hostService.backup({
        name: job.name,
        sourcePath: job.config?.sourcePath || job.source,
        backupPath: job.destination,
        excludes: job.config?.excludes || [],
      });
    } else if (backupType === 'cloud') {
      const cred = db.cloudCredentials.find(c => c.id === job.config?.cloudCredentialId);
      if (!cred) {
        result = { success: false, error: 'Cloud credentials not found' };
      } else {
        const uploadRes = await cloudService.upload(cred, job.source, job.destination);
        result = { success: uploadRes.success, file: uploadRes.url || job.source, error: uploadRes.error || null };
      }
    } else if (backupType === 'ssh') {
      const conn = db.sshConnections.find(c => c.id === job.config?.connectionId);
      if (!conn) {
        result = { success: false, error: 'SSH connection not found' };
      } else {
        result = await sshService.backup({
          connection: conn, name: job.name,
          sourcePath: job.config?.sourcePath || job.source,
          backupPath: job.destination,
          excludes: job.config?.excludes || [],
        });
      }
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
      const logMsg = result.success ? `Backup completed: ${job.name}` : `Backup failed: ${job.name} - ${result.error}`;
      await addLog(logMsg, result.success ? 'success' : 'error');
      await sendNotification(db2, logMsg, result.success ? 'success' : 'error');
    }
  } catch (e) {
    const db3 = await readDB();
    const idx3 = db3.backups.findIndex(x => x.id === req.params.id);
    if (idx3 !== -1) {
      db3.backups[idx3].status = 'failed';
      db3.backups[idx3].error = e.message;
      await writeDB(db3);
      const errMsg = `Backup error: ${job.name} - ${e.message}`;
      await addLog(errMsg, 'error');
      await sendNotification(db3, errMsg, 'error');
    }
  }
});

// ─── Restore ────────────────────────────────────────────────────────────────

app.post('/api/restore', authorize('restore'), async (req, res) => {
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
      let restoreFile = job.resultFile || config?.file;

      if (job.config?.cloudCredentialId) {
        const cred = db.cloudCredentials.find(c => c.id === job.config.cloudCredentialId);
        if (cred) {
          const tempFile = path.join(os.tmpdir(), path.basename(restoreFile || 'restore.sql'));
          const downloadRes = await cloudService.download(cred, path.basename(restoreFile), tempFile);
          if (downloadRes.success) {
            restoreFile = tempFile;
          } else {
            throw new Error(`Failed to download backup file from cloud: ${downloadRes.error}`);
          }
        }
      }

      result = await dbService.restore({
        type: backupType, connection: conn || config, file: restoreFile,
      });

      if (job.config?.cloudCredentialId && restoreFile && restoreFile.startsWith(os.tmpdir())) {
        try { await fs.unlink(restoreFile); } catch (e) { console.error('Failed to cleanup temp file:', e.message); }
      }
    } else if (['vmware', 'hyperv'].includes(backupType)) {
      result = await vmService.restore({
        type: backupType, vmName: config?.vmName || job.name + '-restored',
        host: config?.host, user: config?.user, password: config?.password,
        file: job.resultFile,
      });
    } else if (backupType === 'host') {
      result = await hostService.restore({
        file: job.resultFile,
        targetPath: targetType === 'original' ? (job.config?.sourcePath || job.source || '/') : (config?.targetPath || job.source || '/'),
      });
    } else if (backupType === 'cloud') {
      const cred = db.cloudCredentials.find(c => c.id === job.config?.cloudCredentialId);
      if (!cred) {
        result = { success: false, error: 'Cloud credentials not found' };
      } else {
        const localDest = targetType === 'original' ? job.destination : (config?.localPath || job.destination);
        const downloadRes = await cloudService.download(cred, job.destination, localDest);
        result = { success: downloadRes.success, error: downloadRes.error };
      }
    } else {
      result = { success: true };
    }

    const restoreMsg = result.success ? `Restore completed: ${job.name}` : `Restore failed: ${job.name} - ${result.error}`;
    await addLog(restoreMsg, result.success ? 'success' : 'error');
    const dbAfter = await readDB();
    if (dbAfter) await sendNotification(dbAfter, restoreMsg, result.success ? 'success' : 'error');
  } catch (e) {
    const errMsg = `Restore error: ${job.name} - ${e.message}`;
    await addLog(errMsg, 'error');
    const dbAfter = await readDB();
    if (dbAfter) await sendNotification(dbAfter, errMsg, 'error');
  }
});

// ─── Database Connections ───────────────────────────────────────────────────

app.get('/api/db-connections', async (req, res) => {
  const db = await readDB();
  const safe = (db?.dbConnections || []).map(c => ({ ...c, password: c.password ? '***' : '' }));
  res.json(safe);
});

app.post('/api/db-connections', authorize('manageBackups'), async (req, res) => {
  const v = validate(schemas.dbConnection, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, type, host, port, user, password, database } = v.data;
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const conn = { id: uuidv4(), name, type, host, port: port || 3306, user, password: password || '', database: database || '' };
  db.dbConnections.push(conn);
  if (await writeDB(db)) {
    res.status(201).json({ ...conn, password: '***' });
  } else res.status(500).json({ error: 'Failed to save' });
});

app.put('/api/db-connections/:id', authorize('manageBackups'), async (req, res) => {
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

app.delete('/api/db-connections/:id', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.dbConnections.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.dbConnections.splice(idx, 1);
  if (await writeDB(db)) res.json({ message: 'Deleted' });
  else res.status(500).json({ error: 'Failed to delete' });
});

app.post('/api/db-connections/:id/test', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const conn = db.dbConnections.find(c => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  try {
    const dbs = await dbService.listDatabases(conn.type, conn);
    res.json({ success: dbs.length > 0, databases: dbs });
  } catch (err) {
    res.json({ success: false, error: err.message, databases: [] });
  }
});

app.get('/api/db-connections/:id/databases', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const conn = db.dbConnections.find(c => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  try {
    const dbs = await dbService.listDatabases(conn.type, conn);
    res.json(dbs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SSH Connections ────────────────────────────────────────────────────

app.get('/api/ssh-connections', async (req, res) => {
  const db = await readDB();
  const safe = (db?.sshConnections || []).map(c => ({ ...c, password: c.password ? '***' : '', key: c.key ? '***' : '' }));
  res.json(safe);
});

app.post('/api/ssh-connections', authorize('manageBackups'), async (req, res) => {
  const v = validate(schemas.sshConnection, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, host, port, user, password, key } = v.data;
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const id = uuidv4();
  const keyPath = writeSshKey(id, key);
  const conn = { id, name, host, port: port || 22, user, password: password || '', key: keyPath || '', createdAt: new Date().toISOString() };
  db.sshConnections.push(conn);
  if (await writeDB(db)) {
    await addLog(`SSH connection added: ${name}`, 'success');
    res.status(201).json({ ...conn, password: '***', key: '***' });
  } else res.status(500).json({ error: 'Failed to save' });
});

app.put('/api/ssh-connections/:id', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.sshConnections.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { password, key, ...rest } = req.body;
  db.sshConnections[idx] = { ...db.sshConnections[idx], ...rest };
  if (password && password !== '***') db.sshConnections[idx].password = password;
  if (key && key !== '***') {
    deleteSshKey(db.sshConnections[idx].key);
    db.sshConnections[idx].key = writeSshKey(db.sshConnections[idx].id, key);
  }
  if (await writeDB(db)) {
    await addLog(`SSH connection updated: ${db.sshConnections[idx].name}`, 'info');
    res.json({ ...db.sshConnections[idx], password: '***', key: '***' });
  } else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/ssh-connections/:id', authorize('manageBackups'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.sshConnections.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  deleteSshKey(db.sshConnections[idx].key);
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
  const v = validate(schemas.cloudCredential, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, provider, credentials } = v.data;
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
  const v = validate(schemas.createSchedule, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, cronExpression, backupId } = v.data;
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const schedule = { id: uuidv4(), name, cronExpression, backupId, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.schedules.push(schedule);
  if (await writeDB(db)) {
    refreshScheduler();
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
  if (await writeDB(db)) {
    refreshScheduler();
    res.json(db.schedules[idx]);
  } else res.status(500).json({ error: 'Failed to update' });
});

app.delete('/api/schedules/:id', authorize('manageSchedules'), async (req, res) => {
  const db = await readDB();
  if (!db) return res.status(500).json({ error: 'DB unavailable' });
  const idx = db.schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.schedules.splice(idx, 1);
  if (await writeDB(db)) {
    refreshScheduler();
    res.json({ message: 'Deleted' });
  } else res.status(500).json({ error: 'Failed to delete' });
});

// ─── Notification helper ─────────────────────────────────────────────────────

async function sendNotification(db, message, status) {
  const settings = getSettings(db);
  const { notifications, smtp } = settings;

  if (notifications.email && smtp.host && smtp.user && smtp.password) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port || 587,
        secure: (smtp.encryption || 'tls') === 'ssl',
        auth: { user: smtp.user, pass: smtp.password },
      });
      await transporter.sendMail({
        from: smtp.from || smtp.user,
        to: notifications.email,
        subject: `[BCK] ${status === 'success' ? '✓' : '✗'} ${message}`,
        text: message,
      });
    } catch (e) {
      console.error('Email notification failed:', e.message);
    }
  }

  if (notifications.slack) {
    try {
      await fetch(notifications.slack, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `[BCK] ${status === 'success' ? '✓' : '✗'} ${message}` }),
      });
    } catch (e) {
      console.error('Slack notification failed:', e.message);
    }
  }

  if (notifications.discord) {
    try {
      await fetch(notifications.discord, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `[BCK] ${status === 'success' ? '✓' : '✗'} ${message}` }),
      });
    } catch (e) {
      console.error('Discord notification failed:', e.message);
    }
  }

  if (notifications.telegram && notifications.telegramBotToken) {
    try {
      const chatId = notifications.telegram;
      const text = encodeURIComponent(`[BCK] ${status === 'success' ? '✓' : '✗'} ${message}`);
      await fetch(`https://api.telegram.org/bot${notifications.telegramBotToken}/sendMessage?chat_id=${chatId}&text=${text}`);
    } catch (e) {
      console.error('Telegram notification failed:', e.message);
    }
  }

  if (notifications.webhook) {
    try {
      await fetch(notifications.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'backup', status, message, timestamp: new Date().toISOString() }),
      });
    } catch (e) {
      console.error('Webhook notification failed:', e.message);
    }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let cronTasks = {};

function refreshScheduler() {
  for (const id of Object.keys(cronTasks)) {
    cronTasks[id].stop();
    delete cronTasks[id];
  }

  readDB().then((db) => {
    if (!db) return;
    for (const s of (db.schedules || [])) {
      if (!s.enabled || !s.cronExpression) continue;
      if (!cron.validate(s.cronExpression)) {
        console.warn(`Invalid cron expression for schedule "${s.name}": ${s.cronExpression}`);
        continue;
      }
      const task = cron.schedule(s.cronExpression, async () => {
        const db2 = await readDB();
        if (!db2) return;
        const idx = db2.backups.findIndex(b => b.id === s.backupId);
        if (idx === -1) return;
        const job = db2.backups[idx];
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        await writeDB(db2);
        await addLog(`Scheduled backup started: ${job.name}`, 'info');

        let result;
        const backupType = job.backupType || job.type;

        try {
          if (['mysql', 'postgres', 'oracle'].includes(backupType)) {
            const conn = db2.dbConnections.find(c => c.id === job.config?.connectionId);
            result = await dbService.backup({
              type: backupType, connection: conn || job.config, backupPath: job.destination, name: job.name,
            });
            if (result.success && job.config?.cloudCredentialId) {
              const cred = db2.cloudCredentials.find(c => c.id === job.config.cloudCredentialId);
              if (cred) {
                const uploadRes = await cloudService.upload(cred, result.file, path.basename(result.file));
                if (!uploadRes.success) {
                  result.success = false;
                  result.error = `Backup succeeded but cloud upload failed: ${uploadRes.error}`;
                }
              }
            }
          } else if (['vmware', 'hyperv'].includes(backupType)) {
            result = await vmService.backup({
              type: backupType, vmName: job.config?.vmName || job.name,
              host: job.config?.host, user: job.config?.user, password: job.config?.password,
              datastore: job.config?.datastore, backupPath: job.destination,
            });
          } else if (backupType === 'host') {
            result = await hostService.backup({
              name: job.name,
              sourcePath: job.config?.sourcePath || job.source,
              backupPath: job.destination,
              excludes: job.config?.excludes || [],
            });
          } else if (backupType === 'cloud') {
            const cred = db2.cloudCredentials.find(c => c.id === job.config?.cloudCredentialId);
            if (!cred) {
              result = { success: false, error: 'Cloud credentials not found' };
            } else {
              const uploadRes = await cloudService.upload(cred, job.source, job.destination);
              result = { success: uploadRes.success, file: uploadRes.url || job.source, error: uploadRes.error || null };
            }
          } else if (backupType === 'ssh') {
            const conn = db2.sshConnections.find(c => c.id === job.config?.connectionId);
            result = await sshService.backup({
              connection: conn, name: job.name,
              sourcePath: job.config?.sourcePath || job.source,
              backupPath: job.destination,
              excludes: job.config?.excludes || [],
            });
          } else {
            result = { success: true, file: job.destination, error: null };
          }

          const db3 = await readDB();
          const idx3 = db3.backups.findIndex(b => b.id === s.backupId);
          if (idx3 !== -1) {
            db3.backups[idx3].status = result.success ? 'completed' : 'failed';
            db3.backups[idx3].completedAt = new Date().toISOString();
            db3.backups[idx3].resultFile = result.file || null;
            db3.backups[idx3].error = result.error || null;
            if (result.size) db3.stats.totalSize = (db3.stats.totalSize || 0) + result.size;
            await updateStats(db3);
            await writeDB(db3);
            const logMsg = result.success ? `Scheduled backup completed: ${job.name}` : `Scheduled backup failed: ${job.name} - ${result.error}`;
            await addLog(logMsg, result.success ? 'success' : 'error');
            await sendNotification(db3, logMsg, result.success ? 'success' : 'error');
          }
        } catch (e) {
          const db4 = await readDB();
          const idx4 = db4.backups.findIndex(b => b.id === s.backupId);
          if (idx4 !== -1) {
            db4.backups[idx4].status = 'failed';
            db4.backups[idx4].error = e.message;
            await writeDB(db4);
            const errMsg = `Scheduled backup error: ${job.name} - ${e.message}`;
            await addLog(errMsg, 'error');
            await sendNotification(db4, errMsg, 'error');
          }
        }
      });
      cronTasks[s.id] = task;
    }
  }).catch((err) => {
    console.error('Scheduler refresh failed:', err.message);
  });
}

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
  const v = validate(schemas.createUser, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { username, password, role, email } = v.data;
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
  refreshScheduler();

  const sslCert = process.env.SSL_CERT_PATH;
  const sslKey = process.env.SSL_KEY_PATH;

  if (sslCert && sslKey) {
    try {
      const https = require('https');
      const credentials = { key: fsSync.readFileSync(sslKey), cert: fsSync.readFileSync(sslCert) };
      https.createServer(credentials, app).listen(PORT, HOST, () => {
        console.log(`BCK server (HTTPS) running on ${buildDefaultAppUrl()}`);
      });
    } catch (e) {
      console.error('Failed to start HTTPS server:', e.message);
      process.exit(1);
    }
  } else {
    app.listen(PORT, HOST, () => {
      console.log(`BCK server running on ${buildDefaultAppUrl()}`);
    });
  }
};

start();

module.exports = app;
