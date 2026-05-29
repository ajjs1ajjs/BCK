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

// Ensure ENCRYPTION_KEY is present in environment
if (!process.env.ENCRYPTION_KEY) {
  console.error('FATAL ERROR: ENCRYPTION_KEY is not set in environment variables.');
  console.error('For security reasons, this application will not start without a defined encryption key.');
  console.error('Please add ENCRYPTION_KEY=your-secure-random-secret to your .env file.');
  process.exit(1);
}

const { PORT, HOST, SALT_ROUNDS } = require('./services/config');
const { db, migrate } = require('./services/db');
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

const app = express();
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'db.json'));

// Trust proxy for secure IP whitelisting when running behind reverse proxies
app.set('trust proxy', process.env.TRUST_PROXY === 'true' || true);

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

// ─── Public API Routes ───────────────────────────────────────────────────────

app.use('/api', authRouter);

// Health check endpoint (public)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ─── Authenticated API Routes ────────────────────────────────────────────────

app.use('/api/', authenticate);
app.use('/api', backupsRouter);
app.use('/api', connectionsRouter);
app.use('/api', schedulesRouter);
app.use('/api', usersRouter);
app.use('/api', rolesRouter);
app.use('/api', systemRouter);

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
  migrate(DB_PATH);

  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!admin) {
    console.log('Creating default users and roles...');
    
    // Secure fix: Load admin password from environment or use standard default with a warning
    const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || '291263';
    if (!process.env.DEFAULT_ADMIN_PASSWORD) {
      console.warn('WARNING: DEFAULT_ADMIN_PASSWORD not set in environment. Using default password "291263". Please change this immediately.');
    }
    
    const hashedAdmin = await bcrypt.hash(defaultAdminPassword, SALT_ROUNDS);
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
      
      const appUrl = process.env.APP_URL || '';
      const defaultAppUrl = appUrl || `http://127.0.0.1:${PORT}`;
      insertSetting.run('network', JSON.stringify({ appUrl: defaultAppUrl, bindHost: HOST }));
    })();
  }
};

// ─── Start Server ────────────────────────────────────────────────────────────

const start = async () => {
  await initDB();
  refreshScheduler();
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
    socket.emit('queueStats', backupQueue.getStats());
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });
  });

  server.listen(PORT, HOST, () => {
    const appUrl = process.env.APP_URL || '';
    const displayUrl = appUrl || `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
    console.log(`BCK server running on ${displayUrl}`);
  });
};

start();

module.exports = app;
