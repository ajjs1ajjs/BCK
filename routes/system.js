const express = require('express');
const router = express.Router();
const os = require('os');

const { db } = require('../services/db');
const { getDiskStats } = require('../services/exec');
const dbService = require('../services/database');
const vmService = require('../services/vm');
const cloudService = require('../services/cloud');
const sshService = require('../services/ssh');
const backupQueue = require('../services/queue');

const { authenticate, authorize } = require('../middleware/auth');
const { getSettings, updateSetting, addLog, sendNotification } = require('../services/helpers');
const { PORT } = require('../services/config');

const getLocalIp = () => {
  const interfaces = os.networkInterfaces();
  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return '127.0.0.1';
};

const buildDefaultAppUrl = () => {
  const appUrl = process.env.APP_URL || '';
  return appUrl || `http://${getLocalIp()}:${PORT}`;
};

// GET /api/logs
router.get('/logs', authorize('viewLogs'), async (req, res) => {
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

// POST /api/settings/test-notification
router.post('/settings/test-notification', authorize('configure'), async (req, res) => {
  try {
    await sendNotification('This is a test notification from BCK Backup System.', 'success');
    res.json({ success: true, message: 'Test notification sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send test notification: ' + err.message });
  }
});

// GET /api/tools
router.get('/tools', async (req, res) => {
  const tools = {
    mysql: dbService.checkTools('mysql'),
    postgres: dbService.checkTools('postgres'),
    oracle: dbService.checkTools('oracle'),
    mongodb: dbService.checkTools('mongodb'),
    redis: dbService.checkTools('redis'),
    vmware: vmService.checkTools('vmware'),
    hyperv: vmService.checkTools('hyperv'),
    aws: cloudService.checkTools('aws'),
    azure: cloudService.checkTools('azure'),
    gcp: cloudService.checkTools('gcp'),
    ssh: sshService.checkTools(),
  };
  res.json(tools);
});

// GET /api/health
router.get('/health', async (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memoryUsage: process.memoryUsage(),
  });
});

// GET /api/stats
router.get('/stats', async (req, res) => {
  const backups = db.prepare('SELECT status, completedAt FROM backups').all();
  const total = backups.length;
  const success = backups.filter(b => b.status === 'completed').length;
  const failed = backups.filter(b => b.status === 'failed').length;
  const last = backups.filter(b => b.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
  
  // Implement real disk statistics checking
  const settings = getSettings();
  const backupDir = settings.advanced?.tempPath || '.';
  const disk = getDiskStats(backupDir);

  res.json({
    totalBackups: total,
    successfulBackups: success,
    failedBackups: failed,
    lastBackup: last?.completedAt || null,
    diskSpace: { 
      totalBytes: disk.total, 
      usedBytes: disk.total - disk.free, 
      freeBytes: disk.free, 
      isQuota: false 
    }
  });
});

// GET /api/settings
router.get('/settings', async (req, res) => {
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

// PUT /api/settings
router.put('/settings', authorize('configure'), async (req, res) => {
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

// GET /api/stats/queue
router.get('/stats/queue', (req, res) => {
  res.json(backupQueue.getStats());
});

module.exports = router;
