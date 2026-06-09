const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const morgan = require('morgan');

require('dotenv').config();

// Auto-generate ENCRYPTION_KEY if not set
if (!process.env.ENCRYPTION_KEY) {
  const fallbackKey = require('crypto').randomBytes(32).toString('hex');
  process.env.ENCRYPTION_KEY = fallbackKey;
  console.warn('WARNING: ENCRYPTION_KEY not set. Auto-generated. Set it in .env for persistence.');
}

const { PORT, HOST, SALT_ROUNDS } = require('./services/config');
const { db, migrate, initSchema } = require('./services/db');
const logger = require('./services/logger');
const backupQueue = require('./services/queue');

// Middlewares
const ipAllowlistMiddleware = require('./middleware/ipAllowlist');
const { authenticate } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimit');

// Routers
const authRouter = require('./routes/auth');
const backupsRouter = require('./routes/backups');
const connectionsRouter = require('./routes/connections');
const { refreshScheduler } = require('./routes/schedules');
const schedulesRouter = require('./routes/schedules');
const usersRouter = require('./routes/users');
const rolesRouter = require('./routes/roles');
const systemRouter = require('./routes/system');
const tokensRouter = require('./routes/tokens');
const organizationsRouter = require('./routes/organizations');
const webhooksRouter = require('./routes/webhooks');
const versionsRouter = require('./routes/versions');
const { register: metricsRegister, metricsMiddleware } = require('./services/metrics');

const app = express();
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'db.json'));

// Trust proxy for secure IP whitelisting when running behind reverse proxies
app.set('trust proxy', process.env.TRUST_PROXY === 'true');

// ─── Global Middlewares ──────────────────────────────────────────────────────

app.use(ipAllowlistMiddleware);
app.use(morgan('combined'));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Rate Limiter
app.use('/api/', apiLimiter);

// Prometheus HTTP metrics
app.use(metricsMiddleware);

// Public Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  const metricsToken = process.env.METRICS_TOKEN;
  if (metricsToken) {
    const provided = req.headers['x-metrics-token'] || req.query.token;
    if (provided !== metricsToken) return res.status(401).json({ error: 'Unauthorized' });
  }
  res.setHeader('Content-Type', metricsRegister.contentType);
  res.send(await metricsRegister.metrics());
});

// ─── Public API Routes ───────────────────────────────────────────────────────

app.use('/api', authRouter);

// Health check endpoint (public)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ─── Authenticated API Routes ────────────────────────────────────────────────

const policiesRouter = require('./routes/policies');

app.use('/api/', authenticate);
app.use('/api', systemRouter);
app.use('/api', usersRouter);
app.use('/api', rolesRouter);
app.use('/api', tokensRouter);
app.use('/api', connectionsRouter);
app.use('/api', backupsRouter);
app.use('/api', schedulesRouter);
app.use('/api', organizationsRouter);
app.use('/api', webhooksRouter);
app.use('/api', versionsRouter);
app.use('/api', policiesRouter);

// ─── Frontend Static Files ───────────────────────────────────────────────────

const buildPath = path.join(__dirname, 'frontend', 'build');
fs.access(buildPath).then(() => {
  app.use(express.static(buildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}).catch(() => {
  console.log('No production build found — API only');
});

// ─── DB Initializer ─────────────────────────────────────────────────────────

const initDB = async () => {
  await migrate(DB_PATH);
  await initSchema();

  const admin = await db.get('SELECT * FROM users WHERE username = ?', ['admin']);
  if (!admin) {
    console.log('Creating default users and roles...');
    
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || '291263';
    if (!process.env.DEFAULT_ADMIN_PASSWORD) {
      console.log('\n===================================================================');
      console.log('🔥 INITIAL SETUP: DEFAULT ADMIN CREDENTIALS USED 🔥');
      console.log(`   Username: admin`);
      console.log(`   Password: ${adminPassword}`);
      console.log('   Please log in and change this password immediately in Settings!');
      console.log('===================================================================\n');
    }

    const hashedAdmin = await bcrypt.hash(adminPassword, SALT_ROUNDS);
    const hashedOperator = await bcrypt.hash('operator', SALT_ROUNDS);
    const hashedViewer = await bcrypt.hash('viewer', SALT_ROUNDS);

    const txFn = db.transaction(async () => {
      await db.run('INSERT INTO roles (id, name, level, description, permissions) VALUES (?, ?, ?, ?, ?)',
        ['admin', 'Admin', 100, 'Full system access', JSON.stringify({ manageUsers: true, manageBackups: true, manageSchedules: true, restore: true, delete: true, configure: true, viewLogs: true, manageRoles: true })]);
      await db.run('INSERT INTO roles (id, name, level, description, permissions) VALUES (?, ?, ?, ?, ?)',
        ['operator', 'Operator', 50, 'Manage backups and schedules', JSON.stringify({ manageUsers: false, manageBackups: true, manageSchedules: true, restore: true, delete: false, configure: false, viewLogs: true, manageRoles: false })]);
      await db.run('INSERT INTO roles (id, name, level, description, permissions) VALUES (?, ?, ?, ?, ?)',
        ['viewer', 'Viewer', 10, 'Read-only access', JSON.stringify({ manageUsers: false, manageBackups: false, manageSchedules: false, restore: false, delete: false, configure: false, viewLogs: true, manageRoles: false })]);

      await db.run('INSERT INTO users (id, username, password, role, email, active, "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['admin', 'admin', hashedAdmin, 'admin', 'admin@bck.local', 1, new Date().toISOString()]);
      await db.run('INSERT INTO users (id, username, password, role, email, active, "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['operator', 'operator', hashedOperator, 'operator', 'operator@bck.local', 1, new Date().toISOString()]);
      await db.run('INSERT INTO users (id, username, password, role, email, active, "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['viewer', 'viewer', hashedViewer, 'viewer', 'viewer@bck.local', 1, new Date().toISOString()]);

      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)',
        ['smtp', JSON.stringify({ host: '', port: 587, user: '', password: '', from: '', encryption: 'tls' })]);
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)',
        ['retention', JSON.stringify({ enabled: true, days: 30, copies: 10, customLimitEnabled: false, customLimitGB: 50 })]);
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)',
        ['notifications', JSON.stringify({ email: false, emailOnSuccess: false, slack: '', discord: '', telegram: '', telegramBotToken: '', webhook: '' })]);
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)',
        ['schedule', JSON.stringify({ timezone: 'UTC' })]);
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)',
        ['security', JSON.stringify({ sessionTimeout: 60, preventConcurrent: false, minPasswordLength: 6 })]);
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)',
        ['advanced', JSON.stringify({ tempPath: '', bandwidthLimit: 0, compressionLevel: 'medium' })]);
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)',
        ['ldap', JSON.stringify({ enabled: false, url: 'ldap://localhost:389', baseDn: 'dc=example,dc=org', bindDn: 'cn=admin,dc=example,dc=org', bindPassword: '', userFilter: '(sAMAccountName={{username}})', groupMapping: '{}' })]);
      
      const appUrl = process.env.APP_URL || '';
      const defaultAppUrl = appUrl || `http://127.0.0.1:${PORT}`;
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)',
        ['network', JSON.stringify({ appUrl: defaultAppUrl, bindHost: HOST })]);
    });
    await txFn();
  }
};

// ─── Start Server ────────────────────────────────────────────────────────────

const start = async () => {
  await initDB();
  refreshScheduler();

  try {
    // Reset any jobs that were running when the server crashed
    const runningJobs = await db.all("SELECT id FROM backups WHERE status = 'running'");
    for (const job of runningJobs) {
      await db.run("UPDATE backups SET status = 'failed', error = 'Server restarted during backup' WHERE id = ?", job.id);
    }
  } catch (e) {
    console.error('Failed to recover running jobs:', e.message);
  }

  // Start the background queue processor
  backupQueue.start();
  
  // Start the daily cleanup cron
  const cronManager = require('./services/cron');
  cronManager.start();

  try {
    const { pruneLogs } = require('./services/helpers');
    pruneLogs();
  } catch (e) {
    console.error('Failed to run initial log pruning:', e.message);
  }

  const sslCert = process.env.SSL_CERT_PATH;
  const sslKey = process.env.SSL_KEY_PATH;
  let server;

  if (sslCert && sslKey) {
    try {
      const https = require('https');
      const credentials = { key: fsSync.readFileSync(sslKey), cert: fsSync.readFileSync(sslCert) };
      server = https.createServer(credentials, app);
    } catch (e) {
      console.error('Failed to start HTTPS server:', e.message);
      process.exit(1);
    }
  } else {
    server = require('http').createServer(app);
  }

  const { Server } = require('socket.io');
  const io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : true,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  global.io = io;

  io.on('connection', (socket) => {
    logger.info(`New client connected: ${socket.id}`);
    backupQueue.getStats().then(stats => socket.emit('queueStats', stats));
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });
  });

  server.listen(PORT, HOST, () => {
    const appUrl = process.env.APP_URL || '';
    const displayUrl = appUrl || `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
    console.log(`BCK server running on ${displayUrl}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('HTTP server closed.');
    });
    backupQueue.stop();
    cronManager.stop();
    const { closePool } = require('./services/db');
    await closePool();
    console.log('Database connections closed.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start();

module.exports = app;
