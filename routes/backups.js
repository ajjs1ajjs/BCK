const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fsSync = require('fs');

const { db } = require('../services/db');
const { addLog } = require('../services/helpers');
const { authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { backupRunLimiter } = require('../middleware/rateLimit');
const { executeBackup } = require('../services/backupExecutor');
const { executeRestore } = require('../services/restoreExecutor');
const { validateBackupFile } = require('../services/validator');

// GET /api/backups — with pagination, filtering, and optional export
router.get('/backups', async (req, res) => {
  const { type, status, page, limit: qLimit, export: exportFmt } = req.query;
  const pageSize = Math.min(parseInt(qLimit) || 100, 500);
  const pageNum = Math.max(parseInt(page) || 1, 1);
  const offset = (pageNum - 1) * pageSize;

  const conditions = [];
  const params = [];
  if (type) { conditions.push('(backupType = ? OR type = ?)'); params.push(type, type); }
  if (status) { conditions.push('status = ?'); params.push(status); }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const total = (await db.get(`SELECT COUNT(*) as cnt FROM backups${where}`, ...params)).cnt;

  // Export mode
  if (exportFmt === 'csv' || exportFmt === 'json') {
    const all = await db.all(`SELECT * FROM backups${where} ORDER BY createdAt DESC`, ...params);
    const parsed = all.map(b => ({ ...b, config: JSON.parse(b.config) }));
    if (exportFmt === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename="backups.json"');
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(parsed, null, 2));
    }
    const header = 'id,name,backupType,status,size,createdAt,completedAt\n';
    const rows = parsed.map(b =>
      `"${b.id}","${b.name}","${b.backupType || b.type}","${b.status}","${b.size || 0}","${b.createdAt || ''}","${b.completedAt || ''}"`
    ).join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename="backups.csv"');
    res.setHeader('Content-Type', 'text/csv');
    return res.send(header + rows);
  }

  const items = await db.all(`SELECT * FROM backups${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ data: items.map(b => ({ ...b, config: JSON.parse(b.config) })), total, page: pageNum, pageSize, totalPages: Math.ceil(total / pageSize) });
});

// POST /api/backups
router.post('/backups', authorize('manageBackups'), async (req, res) => {
  const v = validate('createBackup', req.body);
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
    await db.run(`
      INSERT INTO backups (id, name, source, destination, type, backupType, config, status, createdAt, updatedAt)
      VALUES (@id, @name, @source, @destination, @type, @backupType, @config, @status, @createdAt, @updatedAt)
    `, backup);
    
    await addLog(`Created backup: ${name} [${backupType}]`, 'success');
    res.status(201).json({ ...backup, config: config || {} });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

// GET /api/backups/:id
router.get('/backups/:id', async (req, res) => {
  const b = await db.get('SELECT * FROM backups WHERE id = ?', req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json({ ...b, config: JSON.parse(b.config) });
});

// PUT /api/backups/:id
router.put('/backups/:id', authorize('manageBackups'), async (req, res) => {
  const b = await db.get('SELECT * FROM backups WHERE id = ?', req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...b, ...req.body, updatedAt: new Date().toISOString() };
  if (req.body.config) update.config = JSON.stringify(req.body.config);
  
  try {
    await db.run(`
      UPDATE backups SET 
        name = @name, source = @source, destination = @destination, 
        type = @type, backupType = @backupType, config = @config, 
        status = @status, updatedAt = @updatedAt 
      WHERE id = @id
    `, update);
    
    await addLog(`Updated backup: ${update.name}`, 'success');
    res.json({ ...update, config: JSON.parse(update.config) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

// DELETE /api/backups/:id
router.delete('/backups/:id', authorize('delete'), async (req, res) => {
  const b = await db.get('SELECT * FROM backups WHERE id = ?', req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  
  try {
    await db.run('DELETE FROM backups WHERE id = ?', req.params.id);
    await addLog(`Deleted backup: ${b.name}`, 'success');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

// GET /api/vm-backups
router.get('/vm-backups', async (req, res) => {
  const vmJobs = await db.all("SELECT * FROM backups WHERE backupType IN ('vmware', 'hyperv')");
  res.json(vmJobs.map(b => ({ ...b, config: JSON.parse(b.config) })));
});

// POST /api/vm-backups
router.post('/vm-backups', authorize('manageBackups'), async (req, res) => {
  const { name, type, config } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type required' });
  
  const id = uuidv4();
  const now = new Date().toISOString();
  try {
    await db.run(`
      INSERT INTO backups (id, name, type, backupType, config, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, id, name, 'full', type, JSON.stringify(config || {}), 'pending', now, now);
    
    res.status(201).json({ id, name, type, config: config || {} });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

// POST /api/backups/:id/run
router.post('/backups/:id/run', backupRunLimiter, authorize('manageBackups'), async (req, res) => {
  const b = await db.get('SELECT * FROM backups WHERE id = ?', req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });

  executeBackup(req.params.id).catch(() => {});
  res.json({ message: `Backup ${b.name} added to queue`, id: b.id });
});

// POST /api/restore
router.post('/restore', authorize('restore'), async (req, res) => {
  const { backupId, targetType, config } = req.body;
  const b = await db.get('SELECT * FROM backups WHERE id = ?', backupId);
  if (!b) return res.status(404).json({ error: 'Backup not found' });
  const job = { ...b, config: JSON.parse(b.config) };

  try {
    executeRestore(backupId, targetType, config);
    res.json({ message: `Restore of ${job.name} initiated` });
  } catch (e) {
    res.status(500).json({ error: `Failed to initiate restore: ${e.message}` });
  }
});

// POST /api/backups/:id/validate
router.post('/backups/:id/validate', authorize('manageBackups'), async (req, res) => {
  const b = await db.get('SELECT * FROM backups WHERE id = ?', req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'completed') return res.status(400).json({ error: 'Only completed backups can be validated' });

  const jobConfig = JSON.parse(b.config || '{}');
  const backupType = b.backupType || b.type;
  
  // Basic validation without downloading from cloud for now (we validate local disk only)
  const filePath = b.resultFile || b.destination;
  
  try {
    await validateBackupFile(backupType, filePath, jobConfig.encryptionPassword);
    const now = new Date().toISOString();
    await db.run('UPDATE backups SET "lastValidatedAt" = ?, "validationStatus" = ? WHERE id = ?', now, 'valid', b.id);
    await addLog(`Backup validated successfully: ${b.name}`, 'info');
    res.json({ message: 'Validation successful', valid: true });
  } catch (err) {
    const now = new Date().toISOString();
    await db.run('UPDATE backups SET "lastValidatedAt" = ?, "validationStatus" = ? WHERE id = ?', now, 'invalid', b.id);
    await addLog(`Backup validation failed: ${b.name} - ${err.message}`, 'error');
    res.status(400).json({ error: err.message, valid: false });
  }
});

// GET /api/backups/:id/download
router.get('/backups/:id/download', authorize('restore'), async (req, res) => {
  try {
    const b = await db.get('SELECT * FROM backups WHERE id = ?', req.params.id);
    if (!b) return res.status(404).json({ error: 'Backup job not found' });
    if (b.status !== 'completed' || !b.resultFile) {
      return res.status(400).json({ error: 'Backup is not completed or has no output file' });
    }
    const filePath = path.resolve(b.resultFile);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file does not exist on disk' });
    }
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    res.status(500).json({ error: 'Download failed: ' + err.message });
  }
});

module.exports = router;
module.exports.executeBackup = executeBackup; // Export to be used in scheduler
