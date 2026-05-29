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
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

// Ensure ENCRYPTION_KEY is present in environment
if (!process.env.ENCRYPTION_KEY) {
  console.error('FATAL ERROR: ENCRYPTION_KEY is not set in environment variables.');
  console.error('For security reasons, this application will not start without a defined encryption key.');
  console.error('Please add ENCRYPTION_KEY=your-secure-random-secret to your .env file.');
  process.exit(1);
}

const { db, migrate } = require('./services/db');
const cryptoHelper = require('./services/crypto');
const logger = require('./services/logger');

const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { z } = require('zod');

const dbService = require('./services/database');
const vmService = require('./services/vm');
const cloudService = require('./services/cloud');
const hostService = require('./services/host');
const sshService = require('./services/ssh');

const backupQueue = require('./services/queue');
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
app.use(morgan('combined'));
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
  try {
    db.prepare('INSERT INTO logs (id, timestamp, message, status) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), new Date().toISOString(), message, status);
    
    const count = db.prepare('SELECT COUNT(*) as count FROM logs').get().count;
    if (count > 500) {
      db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?)')
        .run(count - 500);
    }
  } catch (err) {
    logger.error('Failed to add log: ' + err.message);
  }
  
  if (status === 'error' || status === 'failed') {
    logger.error(message);
  } else {
    logger.info(message);
  }
};

const getSettings = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(row => {
    settings[row.key] = JSON.parse(row.value);
  });
  return settings;
};

const updateSetting = (key, value) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, JSON.stringify(value));
};

const pruneBackups = async (job) => {
  try {
    const settings = getSettings();
    const { retention } = settings;
    if (!retention || !retention.enabled) return;

    const destDir = job.destination;
    if (!destDir) return;
    if (!fsSync.existsSync(destDir)) return;

    const files = await fs.readdir(destDir);
    const safeName = String(job.name).replace(/[^a-zA-Z0-9._-]+/g, '_');
    const jobFiles = [];

    for (const file of files) {
      if (file.startsWith(safeName + '_')) {
        const filePath = path.join(destDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            jobFiles.push({ name: file, path: filePath, time: stat.mtimeMs });
          }
        } catch (e) {}
      }
    }

    jobFiles.sort((a, b) => a.time - b.time);

    const now = Date.now();
    const retentionMs = retention.days * 24 * 60 * 60 * 1000;
    const filesToDelete = new Set();

    if (retention.days > 0) {
      for (const file of jobFiles) {
        if (now - file.time > retentionMs) {
          filesToDelete.add(file);
        }
      }
    }

    const remainingFiles = jobFiles.filter(f => !filesToDelete.has(f));
    if (retention.copies > 0 && remainingFiles.length > retention.copies) {
      const toDeleteCount = remainingFiles.length - retention.copies;
      for (let i = 0; i < toDeleteCount; i++) {
        filesToDelete.add(remainingFiles[i]);
      }
    }

    for (const file of filesToDelete) {
      await fs.unlink(file.path);
      await addLog(`Pruned old backup file (retention policy): ${file.name}`, 'info');
    }
  } catch (err) {
    logger.error(`Pruning failed for job ${job.name}: ${err.message}`);
  }
};

const SSH_KEYS_DIR = path.join(__dirname, 'data', 'ssh_keys');

function writeSshKey(id, keyContent) {
  if (!keyContent) return '';
  const dir = SSH_KEYS_DIR;
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, `${id}.pem`);
  fsSync.writeFileSync(keyPath, keyContent, 'utf8');
  fsSync.chmodSync(keyPath, 0o600);
  return keyPath;
}

function deleteSshKey(keyPath) {
  if (!keyPath) return;
  try { fsSync.unlinkSync(keyPath); } catch (e) { console.error('Failed to delete SSH key:', e.message); }
}

const initDB = async () => {
  migrate(DB_PATH);

  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!admin) {
    console.log('Creating default users and roles...');
    const hashedAdmin = await bcrypt.hash('291263', SALT_ROUNDS);
    const hashedOperator = await bcrypt.hash('operator', SALT_ROUNDS);
    const hashedViewer = await bcrypt.hash('viewer', SALT_ROUNDS);

    db.transaction(() => {
      const insertRole = db.prepare('INSERT INTO roles (id, name, level, description, permissions) VALUES (?, ?, ?, ?, ?)');
      insertRole.run('admin', 'Admin', 100, 'Full system access', JSON.stringify({ manageUsers: true, manageBackups: true, manageSchedules: true, restore: true, delete: true, configure: true, viewLogs: true, manageRoles: true }));
      insertRole.run('operator', 'Operator', 50, 'Manage backups and schedules', JSON.stringify({ manageUsers: false, manageBackups: true, manageSchedules: true, restore: true, delete: false, configure: false, viewLogs: true, manageRoles: false }));
      insertRole.run('viewer', 'Viewer', 10, 'Read-only access', JSON.stringify({ manageUsers: false, manageBackups: false, manageSchedules: false, restore: false, delete: false, configure: false, viewLogs: true, manageRoles: false }));

      const insertUser = db.prepare('INSERT INTO users (id, username, password, role, email, active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
      insertUser.run('admin', 'admin', hashedAdmin, 'admin', 'admin@bck.local', 1, new Date().toISOString());
      insertUser.run('operator', 'operator', hashedOperator, 'operator', 'operator@bck.local', 1, new Date().toISOString());
      insertUser.run('viewer', 'viewer', hashedViewer, 'viewer', 'viewer@bck.local', 1, new Date().toISOString());

      const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      insertSetting.run('smtp', JSON.stringify({ host: '', port: 587, user: '', password: '', from: '', encryption: 'tls' }));
      insertSetting.run('retention', JSON.stringify({ enabled: true, days: 30, copies: 10, customLimitEnabled: false, customLimitGB: 50 }));
      insertSetting.run('notifications', JSON.stringify({ email: false, emailOnSuccess: false, slack: '', discord: '', telegram: '', telegramBotToken: '', webhook: '' }));
      insertSetting.run('schedule', JSON.stringify({ timezone: 'UTC' }));
      insertSetting.run('security', JSON.stringify({ sessionTimeout: 60, preventConcurrent: false, minPasswordLength: 6 }));
      insertSetting.run('advanced', JSON.stringify({ tempPath: '', bandwidthLimit: 0, compressionLevel: 'medium' }));
      insertSetting.run('network', JSON.stringify({ appUrl: APP_URL, bindHost: HOST }));
    })();
  }
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
  
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role);
  const permissions = role ? JSON.parse(role.permissions) : {};
  
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, permissions },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
  });
  
  res.json({ token, username: user.username, role: user.role, permissions });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.use('/api/', authenticate);

// ─── Logs, Stats, Settings ──────────────────────────────────────────────────

app.get('/api/logs', authorize('viewLogs'), async (req, res) => {
  const { level, limit: qLimit } = req.query;
  let query = 'SELECT * FROM logs';
  const params = [];
  
  if (level) {
    query += ' WHERE status = ?';
    params.push(level);
  }
  
  query += ' ORDER BY timestamp DESC';
  
  if (qLimit) {
    query += ' LIMIT ?';
    params.push(parseInt(qLimit));
  }
  
  const items = db.prepare(query).all(...params);
  res.json(items);
});

// ─── Backups CRUD ───────────────────────────────────────────────────────────

app.get('/api/backups', async (req, res) => {
  const { type } = req.query;
  let query = 'SELECT * FROM backups';
  const params = [];
  
  if (type) {
    query += ' WHERE backupType = ? OR type = ?';
    params.push(type, type);
  }
  
  query += ' ORDER BY createdAt DESC';
  
  const items = db.prepare(query).all(...params);
  res.json(items.map(b => ({ ...b, config: JSON.parse(b.config) })));
});

app.post('/api/backups', authorize('manageBackups'), async (req, res) => {
  const v = validate(schemas.createBackup, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, source, destination, type, backupType, config } = v.data;
  
  const id = uuidv4();
  const now = new Date().toISOString();
  const backup = {
    id, name, source, destination,
    type: type || 'full', backupType: backupType || 'files',
    config: JSON.stringify(config || {}),
    status: 'pending', createdAt: now, updatedAt: now,
  };
  
  try {
    db.prepare(`
      INSERT INTO backups (id, name, source, destination, type, backupType, config, status, createdAt, updatedAt)
      VALUES (@id, @name, @source, @destination, @type, @backupType, @config, @status, @createdAt, @updatedAt)
    `).run(backup);
    
    await addLog(`Created backup: ${name} [${backupType}]`, 'success');
    res.status(201).json({ ...backup, config: config || {} });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

app.get('/api/backups/:id', async (req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json({ ...b, config: JSON.parse(b.config) });
});

app.put('/api/backups/:id', authorize('manageBackups'), async (req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...b, ...req.body, updatedAt: new Date().toISOString() };
  if (req.body.config) update.config = JSON.stringify(req.body.config);
  
  try {
    db.prepare(`
      UPDATE backups SET 
        name = @name, source = @source, destination = @destination, 
        type = @type, backupType = @backupType, config = @config, 
        status = @status, updatedAt = @updatedAt 
      WHERE id = @id
    `).run(update);
    
    await addLog(`Updated backup: ${update.name}`, 'success');
    res.json({ ...update, config: JSON.parse(update.config) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

app.delete('/api/backups/:id', authorize('delete'), async (req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  
  try {
    db.prepare('DELETE FROM backups WHERE id = ?').run(req.params.id);
    await addLog(`Deleted backup: ${b.name}`, 'success');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

app.get('/api/vm-backups', async (req, res) => {
  const vmJobs = db.prepare("SELECT * FROM backups WHERE backupType IN ('vmware', 'hyperv')").all();
  res.json(vmJobs.map(b => ({ ...b, config: JSON.parse(b.config) })));
});

app.post('/api/vm-backups', authorize('manageBackups'), async (req, res) => {
  const { name, type, config } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type required' });
  
  const id = uuidv4();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO backups (id, name, type, backupType, config, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, 'full', type, JSON.stringify(config || {}), 'pending', now, now);
    
    res.status(201).json({ id, name, type, config: config || {} });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

const executeBackup = async (jobId) => {
  return backupQueue.push(jobId, async () => {
    const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(jobId);
    if (!b) throw new Error('Job not found');
    
    db.prepare('UPDATE backups SET status = ?, startedAt = ? WHERE id = ?')
      .run('running', new Date().toISOString(), jobId);

    try {
      const job = { ...b, config: JSON.parse(b.config) };
      let result;
      const backupType = job.backupType || job.type;

      if (['mysql', 'postgres', 'oracle'].includes(backupType)) {
        const connRaw = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(job.config?.connectionId);
        const conn = connRaw ? { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) } : job.config;
        result = await dbService.backup({
          type: backupType, connection: conn, backupPath: job.destination, name: job.name,
        });
        if (result.success && job.config?.cloudCredentialId) {
          const credRaw = db.prepare('SELECT * FROM cloud_credentials WHERE id = ?').get(job.config.cloudCredentialId);
          if (credRaw) {
            const cred = { ...credRaw, credentials: JSON.parse(credRaw.credentials) };
            ['secretAccessKey', 'accessKey', 'password', 'credentials'].forEach(k => {
              if (cred.credentials[k] && cred.credentials[k] !== '***') {
                 try {
                   const dec = cryptoHelper.decrypt(cred.credentials[k]);
                   if (k === 'credentials') {
                     try { cred.credentials[k] = JSON.parse(dec); } catch { cred.credentials[k] = dec; }
                   } else {
                     cred.credentials[k] = dec;
                   }
                 } catch (e) {}
              }
            });
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
        const credRaw = db.prepare('SELECT * FROM cloud_credentials WHERE id = ?').get(job.config?.cloudCredentialId);
        if (!credRaw) {
          result = { success: false, error: 'Cloud credentials not found' };
        } else {
          const cred = { ...credRaw, credentials: JSON.parse(credRaw.credentials) };
          ['secretAccessKey', 'accessKey', 'password', 'credentials'].forEach(k => {
            if (cred.credentials[k] && cred.credentials[k] !== '***') {
               try {
                 const dec = cryptoHelper.decrypt(cred.credentials[k]);
                 if (k === 'credentials') {
                   try { cred.credentials[k] = JSON.parse(dec); } catch { cred.credentials[k] = dec; }
                 } else {
                   cred.credentials[k] = dec;
                 }
               } catch (e) {}
            }
          });
          const uploadRes = await cloudService.upload(cred, job.source, job.destination);
          result = { success: uploadRes.success, file: uploadRes.url || job.source, error: uploadRes.error || null };
        }
      } else if (backupType === 'ssh') {
        const connRaw = db.prepare('SELECT * FROM ssh_connections WHERE id = ?').get(job.config?.connectionId);
        if (!connRaw) {
          result = { success: false, error: 'SSH connection not found' };
        } else {
          const conn = { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) };
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

      const status = result.success ? 'completed' : 'failed';
      const now = new Date().toISOString();
      db.prepare('UPDATE backups SET status = ?, completedAt = ?, resultFile = ?, error = ?, size = ? WHERE id = ?')
        .run(status, now, result.file || null, result.error || null, result.size || 0, jobId);

      const logMsg = result.success ? `Backup completed: ${job.name}` : `Backup failed: ${job.name} - ${result.error}`;
      await addLog(logMsg, result.success ? 'success' : 'error');
      await sendNotification(logMsg, result.success ? 'success' : 'error');
      
      if (result.success) {
        await pruneBackups(job);
      }
      return result;
    } catch (e) {
      db.prepare('UPDATE backups SET status = ?, error = ? WHERE id = ?')
        .run('failed', e.message, jobId);
      const errMsg = `Backup error: ${b.name} - ${e.message}`;
      await addLog(errMsg, 'error');
      await sendNotification(errMsg, 'error');
      throw e;
    }
  }, { name: db.prepare('SELECT name FROM backups WHERE id = ?').get(jobId)?.name });
};

// ─── Backup Execution ───────────────────────────────────────────────────────

app.post('/api/backups/:id/run', authorize('manageBackups'), async (req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });

  executeBackup(req.params.id).catch(() => {});
  res.json({ message: `Backup ${b.name} added to queue`, id: b.id });
});

// ─── Restore ────────────────────────────────────────────────────────────────

app.post('/api/restore', authorize('restore'), async (req, res) => {
  const { backupId, targetType, config } = req.body;
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId);
  if (!b) return res.status(404).json({ error: 'Backup not found' });
  const job = { ...b, config: JSON.parse(b.config) };

  await addLog(`Restore started: ${job.name}`, 'info');
  res.json({ message: `Restore of ${job.name} initiated` });

  (async () => {
    try {
      let result;
      const backupType = job.backupType || job.type;

      if (['mysql', 'postgres', 'oracle'].includes(backupType)) {
        const connRaw = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(config?.connectionId);
        const conn = connRaw ? { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) } : null;
        let restoreFile = job.resultFile || config?.file;

        if (job.config?.cloudCredentialId) {
          const credRaw = db.prepare('SELECT * FROM cloud_credentials WHERE id = ?').get(job.config.cloudCredentialId);
          if (credRaw) {
            const cred = { ...credRaw, credentials: JSON.parse(credRaw.credentials) };
            ['secretAccessKey', 'accessKey', 'password', 'credentials'].forEach(k => {
              if (cred.credentials[k] && cred.credentials[k] !== '***') {
                try {
                  const dec = cryptoHelper.decrypt(cred.credentials[k]);
                  if (k === 'credentials') {
                    try { cred.credentials[k] = JSON.parse(dec); } catch { cred.credentials[k] = dec; }
                  } else {
                    cred.credentials[k] = dec;
                  }
                } catch (e) {}
              }
            });
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
          try { await fs.unlink(restoreFile); } catch (e) {}
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
        const credRaw = db.prepare('SELECT * FROM cloud_credentials WHERE id = ?').get(job.config?.cloudCredentialId);
        if (!credRaw) {
          result = { success: false, error: 'Cloud credentials not found' };
        } else {
          const cred = { ...credRaw, credentials: JSON.parse(credRaw.credentials) };
          const localDest = targetType === 'original' ? job.destination : (config?.localPath || job.destination);
          const downloadRes = await cloudService.download(cred, job.destination, localDest);
          result = { success: downloadRes.success, error: downloadRes.error };
        }
      } else {
        result = { success: true };
      }

      const restoreMsg = result.success ? `Restore completed: ${job.name}` : `Restore failed: ${job.name} - ${result.error}`;
      await addLog(restoreMsg, result.success ? 'success' : 'error');
      await sendNotification(restoreMsg, result.success ? 'success' : 'error');
    } catch (e) {
      const errMsg = `Restore error: ${job.name} - ${e.message}`;
      await addLog(errMsg, 'error');
      await sendNotification(errMsg, 'error');
    }
  })();
});

// ─── Database Connections ───────────────────────────────────────────────────

app.get('/api/db-connections', async (req, res) => {
  const items = db.prepare('SELECT * FROM db_connections').all();
  res.json(items.map(c => ({ ...c, password: c.password ? '***' : '' })));
});

app.post('/api/db-connections', authorize('manageBackups'), async (req, res) => {
  const v = validate(schemas.dbConnection, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, type, host, port, user, password, database } = v.data;
  const conn = { id: uuidv4(), name, type, host, port: port || 3306, user, password: cryptoHelper.encrypt(password || ''), database: database || '' };
  
  try {
    db.prepare('INSERT INTO db_connections (id, name, type, host, port, user, password, database) VALUES (@id, @name, @type, @host, @port, @user, @password, @database)')
      .run(conn);
    res.status(201).json({ ...conn, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

app.put('/api/db-connections/:id', authorize('manageBackups'), async (req, res) => {
  const conn = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...conn, ...req.body };
  if (req.body.password && req.body.password !== '***') {
    update.password = cryptoHelper.encrypt(req.body.password);
  }
  
  try {
    db.prepare('UPDATE db_connections SET name = @name, type = @type, host = @host, port = @port, user = @user, password = @password, database = @database WHERE id = @id')
      .run(update);
    res.json({ ...update, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

app.delete('/api/db-connections/:id', authorize('manageBackups'), async (req, res) => {
  try {
    db.prepare('DELETE FROM db_connections WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

app.post('/api/db-connections/:id/test', authorize('manageBackups'), async (req, res) => {
  const connRaw = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(req.params.id);
  if (!connRaw) return res.status(404).json({ error: 'Not found' });
  const conn = { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) };
  try {
    const dbs = await dbService.listDatabases(conn.type, conn);
    res.json({ success: dbs.length > 0, databases: dbs });
  } catch (err) {
    res.json({ success: false, error: err.message, databases: [] });
  }
});

// ─── SSH Connections ────────────────────────────────────────────────────

app.get('/api/ssh-connections', async (req, res) => {
  const items = db.prepare('SELECT * FROM ssh_connections').all();
  res.json(items.map(c => ({ ...c, password: c.password ? '***' : '', key: c.key ? '***' : '' })));
});

app.post('/api/ssh-connections', authorize('manageBackups'), async (req, res) => {
  const v = validate(schemas.sshConnection, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, host, port, user, password, key } = v.data;
  const id = uuidv4();
  const keyPath = writeSshKey(id, key);
  const conn = { id, name, host, port: port || 22, user, password: cryptoHelper.encrypt(password || ''), key: keyPath || '', createdAt: new Date().toISOString() };
  
  try {
    db.prepare('INSERT INTO ssh_connections (id, name, host, port, user, password, key, createdAt) VALUES (@id, @name, @host, @port, @user, @password, @key, @createdAt)')
      .run(conn);
    await addLog(`SSH connection added: ${name}`, 'success');
    res.status(201).json({ ...conn, password: '***', key: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

app.put('/api/ssh-connections/:id', authorize('manageBackups'), async (req, res) => {
  const conn = db.prepare('SELECT * FROM ssh_connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...conn, ...req.body };
  if (req.body.password && req.body.password !== '***') {
    update.password = cryptoHelper.encrypt(req.body.password);
  }
  if (req.body.key && req.body.key !== '***') {
    deleteSshKey(conn.key);
    update.key = writeSshKey(conn.id, req.body.key);
  }
  
  try {
    db.prepare('UPDATE ssh_connections SET name = @name, host = @host, port = @port, user = @user, password = @password, key = @key WHERE id = @id')
      .run(update);
    await addLog(`SSH connection updated: ${update.name}`, 'info');
    res.json({ ...update, password: '***', key: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

app.delete('/api/ssh-connections/:id', authorize('manageBackups'), async (req, res) => {
  const conn = db.prepare('SELECT * FROM ssh_connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  deleteSshKey(conn.key);
  try {
    db.prepare('DELETE FROM ssh_connections WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

app.post('/api/ssh-connections/:id/test', authorize('manageBackups'), async (req, res) => {
  const connRaw = db.prepare('SELECT * FROM ssh_connections WHERE id = ?').get(req.params.id);
  if (!connRaw) return res.status(404).json({ error: 'Not found' });
  const conn = { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) };
  try {
    const r = await sshService.exec(conn, 'echo BCK_CONNECTED && hostname');
    res.json({ success: r.success, hostname: r.stdout || null, error: r.stderr || null });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ─── Cloud Credentials ──────────────────────────────────────────────────

app.get('/api/cloud-credentials', async (req, res) => {
  const items = db.prepare('SELECT * FROM cloud_credentials').all();
  res.json(items.map(c => ({ ...c, credentials: { ...JSON.parse(c.credentials), secretAccessKey: '***', accessKey: '***', password: '***' } })));
});

app.post('/api/cloud-credentials', authorize('manageBackups'), async (req, res) => {
  const v = validate(schemas.cloudCredential, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, provider, credentials } = v.data;

  const encryptedCredentials = { ...credentials };
  if (encryptedCredentials.secretAccessKey) encryptedCredentials.secretAccessKey = cryptoHelper.encrypt(encryptedCredentials.secretAccessKey);
  if (encryptedCredentials.accessKey) encryptedCredentials.accessKey = cryptoHelper.encrypt(encryptedCredentials.accessKey);
  if (encryptedCredentials.password) encryptedCredentials.password = cryptoHelper.encrypt(encryptedCredentials.password);
  if (encryptedCredentials.credentials) {
    if (typeof encryptedCredentials.credentials === 'object') {
      encryptedCredentials.credentials = cryptoHelper.encrypt(JSON.stringify(encryptedCredentials.credentials));
    } else {
      encryptedCredentials.credentials = cryptoHelper.encrypt(encryptedCredentials.credentials);
    }
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  try {
    db.prepare('INSERT INTO cloud_credentials (id, name, provider, credentials, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, provider, JSON.stringify(encryptedCredentials), now);
    await addLog(`Cloud credentials added: ${name} [${provider}]`, 'success');
    res.status(201).json({ id, name, provider, credentials: { ...credentials, secretAccessKey: '***', accessKey: '***', password: '***' } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

app.put('/api/cloud-credentials/:id', authorize('manageBackups'), async (req, res) => {
  const curr = db.prepare('SELECT * FROM cloud_credentials WHERE id = ?').get(req.params.id);
  if (!curr) return res.status(404).json({ error: 'Not found' });
  
  const { credentials, name } = req.body;
  let finalCreds = JSON.parse(curr.credentials);
  
  if (credentials) {
    for (const [k, v] of Object.entries(credentials)) {
      if (v !== '***') {
        if (['secretAccessKey', 'accessKey', 'password'].includes(k)) {
          finalCreds[k] = cryptoHelper.encrypt(v);
        } else if (k === 'credentials') {
          finalCreds[k] = cryptoHelper.encrypt(typeof v === 'object' ? JSON.stringify(v) : v);
        } else {
          finalCreds[k] = v;
        }
      }
    }
  }
  
  try {
    db.prepare('UPDATE cloud_credentials SET name = ?, credentials = ? WHERE id = ?')
      .run(name || curr.name, JSON.stringify(finalCreds), req.params.id);
    res.json({ id: curr.id, name: name || curr.name, provider: curr.provider, credentials: { ...finalCreds, secretAccessKey: '***', accessKey: '***', password: '***' } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

app.delete('/api/cloud-credentials/:id', authorize('manageBackups'), async (req, res) => {
  try {
    db.prepare('DELETE FROM cloud_credentials WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

app.post('/api/cloud-credentials/:id/test', authorize('manageBackups'), async (req, res) => {
  const credRaw = db.prepare('SELECT * FROM cloud_credentials WHERE id = ?').get(req.params.id);
  if (!credRaw) return res.status(404).json({ error: 'Not found' });

  const cred = { ...credRaw, credentials: JSON.parse(credRaw.credentials) };
  ['secretAccessKey', 'accessKey', 'password', 'credentials'].forEach(k => {
    if (cred.credentials[k] && cred.credentials[k] !== '***') {
       try {
         const dec = cryptoHelper.decrypt(cred.credentials[k]);
         if (k === 'credentials') {
           try { cred.credentials[k] = JSON.parse(dec); } catch { cred.credentials[k] = dec; }
         } else {
           cred.credentials[k] = dec;
         }
       } catch (e) {}
    }
  });

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

// ─── Health check ───────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memoryUsage: process.memoryUsage(),
  });
});

// ─── Stats ──────────────────────────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  const backups = db.prepare('SELECT status, completedAt FROM backups').all();
  const total = backups.length;
  const success = backups.filter(b => b.status === 'completed').length;
  const failed = backups.filter(b => b.status === 'failed').length;
  const last = backups.filter(b => b.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
  
  // In a real system, disk space would be checked here
  res.json({
    totalBackups: total,
    successfulBackups: success,
    failedBackups: failed,
    lastBackup: last?.completedAt || null,
    diskSpace: { totalBytes: 100*1024*1024*1024, usedBytes: 10*1024*1024*1024, freeBytes: 90*1024*1024*1024, isQuota: false }
  });
});

// ─── Settings ───────────────────────────────────────────────────────────────

app.get('/api/settings', async (req, res) => {
  const settings = getSettings();
  const safe = {
    ...settings,
    smtp: { ...settings.smtp, password: settings.smtp?.password ? '***' : '' },
    network: {
      ...settings.network,
      localIp: getLocalIp(),
      effectiveAppUrl: settings.network?.appUrl || buildDefaultAppUrl(),
    },
  };
  res.json(safe);
});

app.put('/api/settings', authorize('configure'), async (req, res) => {
  const body = req.body;
  const current = getSettings();

  const merged = {
    smtp: { ...current.smtp, ...(body.smtp || {}) },
    retention: { ...current.retention, ...(body.retention || {}) },
    notifications: { ...current.notifications, ...(body.notifications || {}) },
    schedule: { ...current.schedule, ...(body.schedule || {}) },
    security: { ...current.security, ...(body.security || {}) },
    advanced: { ...current.advanced, ...(body.advanced || {}) },
    network: { ...current.network, ...(body.network || {}) },
  };

  if (body.smtp && body.smtp.password === '***') {
    merged.smtp.password = current.smtp.password;
  }

  try {
    db.transaction(() => {
      for (const [key, value] of Object.entries(merged)) {
        updateSetting(key, value);
      }
    })();
    await addLog('Settings updated', 'info');
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings: ' + err.message });
  }
});

// ─── Users ──────────────────────────────────────────────────────────────────

app.get('/api/users', authorize('manageUsers'), async (req, res) => {
  const users = db.prepare('SELECT id, username, role, email, active, createdAt FROM users').all();
  res.json(users);
});

app.post('/api/users', authorize('manageUsers'), async (req, res) => {
  const v = validate(schemas.createUser, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { username, password, role, email } = v.data;
  
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(400).json({ error: 'Username exists' });
  }
  
  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { id: uuidv4(), username, password: hashed, role, email: email || '', active: 1, createdAt: new Date().toISOString() };
  
  try {
    db.prepare('INSERT INTO users (id, username, password, role, email, active, createdAt) VALUES (@id, @username, @password, @role, @email, @active, @createdAt)')
      .run(user);
    await addLog(`User created: ${username}`, 'success');
    res.status(201).json({ ...user, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

app.put('/api/users/:id', authorize('manageUsers'), async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...user, ...req.body };
  if (req.body.password && req.body.password !== '***') {
    update.password = await bcrypt.hash(req.body.password, SALT_ROUNDS);
  }
  update.active = update.active ? 1 : 0;
  
  try {
    db.prepare('UPDATE users SET username = @username, password = @password, role = @role, email = @email, active = @active WHERE id = @id')
      .run(update);
    await addLog(`User updated: ${update.username}`, 'info');
    res.json({ ...update, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

app.delete('/api/users/:id', authorize('manageUsers'), async (req, res) => {
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    await addLog(`User deleted: ${user.username}`, 'warning');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

// ─── Roles ──────────────────────────────────────────────────────────────────

app.get('/api/roles', authorize('manageRoles'), async (req, res) => {
  const roles = db.prepare('SELECT * FROM roles').all();
  res.json(roles.map(r => ({ ...r, permissions: JSON.parse(r.permissions) })));
});

app.post('/api/roles', authorize('manageRoles'), async (req, res) => {
  const { name, description, permissions } = req.body;
  if (!name || !permissions) return res.status(400).json({ error: 'Name and permissions required' });
  const role = { id: uuidv4(), name, description: description || '', level: 1, permissions: JSON.stringify(permissions) };
  
  try {
    db.prepare('INSERT INTO roles (id, name, description, level, permissions) VALUES (@id, @name, @description, @level, @permissions)')
      .run(role);
    await addLog(`Role created: ${name}`, 'success');
    res.status(201).json({ ...role, permissions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

app.put('/api/roles/:id', authorize('manageRoles'), async (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...role, ...req.body };
  if (req.body.permissions) update.permissions = JSON.stringify(req.body.permissions);
  
  try {
    db.prepare('UPDATE roles SET name = @name, description = @description, level = @level, permissions = @permissions WHERE id = @id')
      .run(update);
    await addLog(`Role updated: ${update.name}`, 'info');
    res.json({ ...update, permissions: JSON.parse(update.permissions) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

app.delete('/api/roles/:id', authorize('manageRoles'), async (req, res) => {
  try {
    db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

// ─── Schedules ──────────────────────────────────────────────────────────────

app.get('/api/schedules', async (req, res) => {
  const items = db.prepare('SELECT * FROM schedules').all();
  res.json(items);
});

app.post('/api/schedules', authorize('manageSchedules'), async (req, res) => {
  const v = validate(schemas.createSchedule, req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, cronExpression, backupId } = v.data;
  
  const schedule = { id: uuidv4(), name, cronExpression, backupId, enabled: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  
  try {
    db.prepare('INSERT INTO schedules (id, name, cronExpression, backupId, enabled, createdAt, updatedAt) VALUES (@id, @name, @cronExpression, @backupId, @enabled, @createdAt, @updatedAt)')
      .run(schedule);
    refreshScheduler();
    await addLog(`Schedule created: ${name}`, 'success');
    res.status(201).json(schedule);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

app.put('/api/schedules/:id', authorize('manageSchedules'), async (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...s, ...req.body, updatedAt: new Date().toISOString() };
  update.enabled = update.enabled ? 1 : 0;
  
  try {
    db.prepare('UPDATE schedules SET name = @name, cronExpression = @cronExpression, backupId = @backupId, enabled = @enabled, updatedAt = @updatedAt WHERE id = @id')
      .run(update);
    refreshScheduler();
    res.json(update);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

app.delete('/api/schedules/:id', authorize('manageSchedules'), async (req, res) => {
  try {
    db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
    refreshScheduler();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

// ─── Notification helper ─────────────────────────────────────────────────────

async function sendNotification(message, status) {
  const settings = getSettings();
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

const cronTasks = {};

function refreshScheduler() {
  for (const id of Object.keys(cronTasks)) {
    cronTasks[id].stop();
    delete cronTasks[id];
  }

  const schedules = db.prepare('SELECT * FROM schedules WHERE enabled = 1').all();
  for (const s of schedules) {
    if (!s.cronExpression) continue;
    if (!cron.validate(s.cronExpression)) {
      console.warn(`Invalid cron expression for schedule "${s.name}": ${s.cronExpression}`);
      continue;
    }
    const task = cron.schedule(s.cronExpression, async () => {
      logger.info(`Triggering scheduled backup: ${s.name} (Job: ${s.backupId})`);
      executeBackup(s.backupId).catch(() => {});
    });
    cronTasks[s.id] = task;
  }
}

app.get('/api/stats/queue', (req, res) => {
  res.json(backupQueue.getStats());
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
