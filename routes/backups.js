const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');

const { db } = require('../services/db');
const cryptoHelper = require('../services/crypto');
const logger = require('../services/logger');
const dbService = require('../services/database');
const vmService = require('../services/vm');
const cloudService = require('../services/cloud');
const hostService = require('../services/host');
const sshService = require('../services/ssh');
const backupQueue = require('../services/queue');

const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { addLog, sendNotification, getSettings } = require('../services/helpers');

// Helper to prune backups according to retention policies
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

const executeBackup = async (jobId) => {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(jobId);
  if (!b) throw new Error('Job not found');
  
  if (global.io) {
    global.io.emit('jobQueued', { id: jobId, name: b.name });
    global.io.emit('queueStats', backupQueue.getStats());
  }

  return backupQueue.push(jobId, async () => {
    const jobData = db.prepare('SELECT * FROM backups WHERE id = ?').get(jobId);
    db.prepare('UPDATE backups SET status = ?, startedAt = ? WHERE id = ?')
      .run('running', new Date().toISOString(), jobId);

    if (global.io) {
      global.io.emit('jobStarted', { id: jobId, name: jobData.name });
      global.io.emit('queueStats', backupQueue.getStats());
    }

    try {
      const job = { ...jobData, config: JSON.parse(jobData.config) };
      let result;
      const backupType = job.backupType || job.type;

      if (['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'].includes(backupType)) {
        const connRaw = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(job.config?.connectionId);
        const conn = connRaw ? { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) } : job.config;
        result = await dbService.backup({
          type: backupType, connection: conn, backupPath: job.destination, name: job.name,
        });
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

      if (result.success && backupType !== 'cloud') {
        // 1. Encryption
        if (job.config?.encryption) {
          const encFile = result.file + '.enc';
          try {
            await cryptoHelper.encryptFile(result.file, encFile, job.config.encryptionPassword);
            try { await fs.unlink(result.file); } catch (e) {}
            result.file = encFile;
            const stat = await fs.stat(encFile);
            result.size = stat.size;
          } catch (e) {
            result.success = false;
            result.error = `Backup succeeded but file encryption failed: ${e.message}`;
          }
        }

        // 2. Cloud Upload
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
      }

      const status = result.success ? 'completed' : 'failed';
      const now = new Date().toISOString();
      db.prepare('UPDATE backups SET status = ?, completedAt = ?, resultFile = ?, error = ?, size = ? WHERE id = ?')
        .run(status, now, result.file || null, result.error || null, result.size || 0, jobId);

      const logMsg = result.success ? `Backup completed: ${jobData.name}` : `Backup failed: ${jobData.name} - ${result.error}`;
      await addLog(logMsg, result.success ? 'success' : 'error');
      await sendNotification(logMsg, result.success ? 'success' : 'error');
      
      if (result.success) {
        await pruneBackups(job);
      }

      if (global.io) {
        global.io.emit('jobCompleted', { id: jobId, name: jobData.name, status: result.success ? 'completed' : 'failed' });
        global.io.emit('queueStats', backupQueue.getStats());
      }

      return result;
    } catch (e) {
      db.prepare('UPDATE backups SET status = ?, error = ? WHERE id = ?')
        .run('failed', e.message, jobId);
      const errMsg = `Backup error: ${jobData.name} - ${e.message}`;
      await addLog(errMsg, 'error');
      await sendNotification(errMsg, 'error');

      if (global.io) {
        global.io.emit('jobFailed', { id: jobId, name: jobData.name, error: e.message });
        global.io.emit('queueStats', backupQueue.getStats());
      }
      throw e;
    }
  }, { name: b.name });
};

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
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM backups${where}`).get(...params).cnt;

  // Export mode
  if (exportFmt === 'csv' || exportFmt === 'json') {
    const all = db.prepare(`SELECT * FROM backups${where} ORDER BY createdAt DESC`).all(...params);
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

  const items = db.prepare(`SELECT * FROM backups${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
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

// GET /api/backups/:id
router.get('/backups/:id', async (req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json({ ...b, config: JSON.parse(b.config) });
});

// PUT /api/backups/:id
router.put('/backups/:id', authorize('manageBackups'), async (req, res) => {
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

// DELETE /api/backups/:id
router.delete('/backups/:id', authorize('delete'), async (req, res) => {
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

// GET /api/vm-backups
router.get('/vm-backups', async (req, res) => {
  const vmJobs = db.prepare("SELECT * FROM backups WHERE backupType IN ('vmware', 'hyperv')").all();
  res.json(vmJobs.map(b => ({ ...b, config: JSON.parse(b.config) })));
});

// POST /api/vm-backups
router.post('/vm-backups', authorize('manageBackups'), async (req, res) => {
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

// POST /api/backups/:id/run
router.post('/backups/:id/run', authorize('manageBackups'), async (req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });

  executeBackup(req.params.id).catch(() => {});
  res.json({ message: `Backup ${b.name} added to queue`, id: b.id });
});

// POST /api/restore
router.post('/restore', authorize('restore'), async (req, res) => {
  const { backupId, targetType, config } = req.body;
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId);
  if (!b) return res.status(404).json({ error: 'Backup not found' });
  const job = { ...b, config: JSON.parse(b.config) };

  await addLog(`Restore started: ${job.name}`, 'info');
  res.json({ message: `Restore of ${job.name} initiated` });

  (async () => {
    let tempDownloadedFile = null;
    let tempDecryptedFile = null;
    try {
      let result;
      const backupType = job.backupType || job.type;

      if (['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'].includes(backupType)) {
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
              tempDownloadedFile = tempFile;
            } else {
              throw new Error(`Failed to download backup file from cloud: ${downloadRes.error}`);
            }
          }
        }

        // Decrypt if needed
        if (restoreFile && (restoreFile.endsWith('.enc') || job.config?.encryption)) {
          tempDecryptedFile = path.join(os.tmpdir(), path.basename(restoreFile).replace(/\.enc$/, ''));
          try {
            await cryptoHelper.decryptFile(restoreFile, tempDecryptedFile, job.config?.encryptionPassword);
            restoreFile = tempDecryptedFile;
          } catch (e) {
            throw new Error(`Failed to decrypt backup file: ${e.message}`);
          }
        }

        result = await dbService.restore({
          type: backupType, connection: conn || config, file: restoreFile,
        });

      } else {
        let restoreFile = job.resultFile || config?.file;

        // If stored in cloud (for hosts / VMs if they were uploaded)
        if (job.config?.cloudCredentialId && restoreFile) {
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
            const tempFile = path.join(os.tmpdir(), path.basename(restoreFile));
            const downloadRes = await cloudService.download(cred, path.basename(restoreFile), tempFile);
            if (downloadRes.success) {
              restoreFile = tempFile;
              tempDownloadedFile = tempFile;
            } else {
              throw new Error(`Failed to download backup file from cloud: ${downloadRes.error}`);
            }
          }
        }

        // Decrypt if needed
        if (restoreFile && (restoreFile.endsWith('.enc') || job.config?.encryption)) {
          tempDecryptedFile = path.join(os.tmpdir(), path.basename(restoreFile).replace(/\.enc$/, ''));
          try {
            await cryptoHelper.decryptFile(restoreFile, tempDecryptedFile, job.config?.encryptionPassword);
            restoreFile = tempDecryptedFile;
          } catch (e) {
            throw new Error(`Failed to decrypt backup file: ${e.message}`);
          }
        }

        if (['vmware', 'hyperv'].includes(backupType)) {
          result = await vmService.restore({
            type: backupType, vmName: config?.vmName || job.name + '-restored',
            host: config?.host, user: config?.user, password: config?.password,
            file: restoreFile,
          });
        } else if (backupType === 'host') {
          result = await hostService.restore({
            file: restoreFile,
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
      }

      if (tempDownloadedFile) {
        try { await fs.unlink(tempDownloadedFile); } catch (e) {}
      }
      if (tempDecryptedFile) {
        try { await fs.unlink(tempDecryptedFile); } catch (e) {}
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

// GET /api/backups/:id/download
router.get('/backups/:id/download', authorize('restore'), async (req, res) => {
  try {
    const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
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
