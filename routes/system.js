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

const { authorize } = require('../middleware/auth');
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

// GET /api/logs — with pagination and optional export
router.get('/logs', authorize('viewLogs'), async (req, res) => {
  const { level, page, limit: qLimit, export: exportFmt } = req.query;
  const pageSize = Math.min(parseInt(qLimit) || 100, 500);
  const pageNum = Math.max(parseInt(page) || 1, 1);
  const offset = (pageNum - 1) * pageSize;

  const conditions = [];
  const params = [];
  if (level) { conditions.push('status = ?'); params.push(level); }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const total = (await db.get(`SELECT COUNT(*) as cnt FROM logs${where}`, ...params)).cnt;

  // Export mode: return all matching rows as CSV or JSON file
  if (exportFmt === 'csv' || exportFmt === 'json') {
    const all = await db.all(`SELECT * FROM logs${where} ORDER BY timestamp DESC`, ...params);
    if (exportFmt === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename="logs.json"');
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(all, null, 2));
    }
    const header = 'id,timestamp,status,message\n';
    const rows = all.map(r => `"${r.id}","${r.timestamp}","${r.status}","${(r.message || '').replace(/"/g, '""')}"`).join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename="logs.csv"');
    res.setHeader('Content-Type', 'text/csv');
    return res.send(header + rows);
  }

  const items = await db.all(`SELECT * FROM logs${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ data: items, total, page: pageNum, pageSize, totalPages: Math.ceil(total / pageSize) });
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
  const backups = await db.all('SELECT status, completedAt FROM backups');
  const total = backups.length;
  const success = backups.filter(b => b.status === 'completed').length;
  const failed = backups.filter(b => b.status === 'failed').length;
  const last = backups.filter(b => b.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
  
  // Implement real disk statistics checking
  const settings = await getSettings();
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
  const settings = await getSettings();
  const safe = {
    ...settings,
    smtp: { ...settings.smtp, password: settings.smtp?.password ? '***' : '' },
    ldap: settings.ldap ? { ...settings.ldap, bindPassword: settings.ldap?.bindPassword ? '***' : '' } : { enabled: false, url: 'ldap://localhost:389', baseDn: '', bindDn: '', bindPassword: '', userFilter: '(sAMAccountName={{username}})', groupMapping: '{}' },
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
  const current = await getSettings();

  const merged = {
    smtp: { ...current.smtp, ...(body.smtp || {}) },
    retention: { ...current.retention, ...(body.retention || {}) },
    notifications: { ...current.notifications, ...(body.notifications || {}) },
    schedule: { ...current.schedule, ...(body.schedule || {}) },
    security: { ...current.security, ...(body.security || {}) },
    advanced: { ...current.advanced, ...(body.advanced || {}) },
    network: { ...current.network, ...(body.network || {}) },
    ldap: { ...(current.ldap || {}), ...(body.ldap || {}) },
  };

  if (body.smtp && body.smtp.password === '***') {
    merged.smtp.password = current.smtp.password;
  }

  if (body.ldap && body.ldap.bindPassword === '***') {
    merged.ldap.bindPassword = current.ldap?.bindPassword || '';
  }

  try {
    await db.transaction(async () => {
      for (const [key, value] of Object.entries(merged)) {
        await updateSetting(key, value);
      }
    })();
    await addLog('Settings updated', 'info');
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings: ' + err.message });
  }
});

// GET /api/stats/queue
router.get('/stats/queue', async (req, res) => {
  res.json(backupQueue.getStats());
});

module.exports = router;
