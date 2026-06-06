const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

const { db } = require('./db');
const cryptoHelper = require('./crypto');
const logger = require('./logger');
const cloudService = require('./cloud');
const backupQueue = require('./queue');
const { addLog, sendNotification, getSettings } = require('./helpers');
const webhooks = require('./webhooks');
const StrategyFactory = require('./strategy/StrategyFactory');

const pruneBackups = async (job) => {
  try {
    const settings = await getSettings();
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
  const b = await db.get('SELECT * FROM backups WHERE id = ?', jobId);
  if (!b) throw new Error('Job not found');
  
  await db.run('UPDATE backups SET status = ? WHERE id = ?', 'pending', jobId);

  await backupQueue.push(jobId);
};

const executeBackupInternal = async (jobId) => {
    const jobData = await db.get('SELECT * FROM backups WHERE id = ?', jobId);
    await db.run('UPDATE backups SET status = ?, startedAt = ? WHERE id = ?', 'running', new Date().toISOString(), jobId);

    const backupType = jobData.backupType || jobData.type;

    // Emit backup.started event
    webhooks.emit('backup.started', {
      id: jobId, name: jobData.name,
      type: backupType,
      startedAt: new Date().toISOString(),
    });

    if (global.io) {
      global.io.emit('jobStarted', { id: jobId, name: jobData.name });
      global.io.emit('queueStats', await backupQueue.getStats());
    }

    try {
      const job = { ...jobData, config: JSON.parse(jobData.config) };
      
      const strategy = StrategyFactory.getStrategy(backupType);
      const result = await strategy.backup(job);

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
          const credRaw = await db.get('SELECT * FROM cloud_credentials WHERE id = ?', job.config.cloudCredentialId);
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
      await db.run('UPDATE backups SET status = ?, completedAt = ?, resultFile = ?, error = ?, size = ? WHERE id = ?', status, now, result.file || null, result.error || null, result.size || 0, jobId);

      const logMsg = result.success ? `Backup completed: ${jobData.name}` : `Backup failed: ${jobData.name} - ${result.error}`;
      await addLog(logMsg, result.success ? 'success' : 'error');
      await sendNotification(logMsg, result.success ? 'success' : 'error');

      // Emit typed webhook event
      const eventType = result.success ? 'backup.completed' : 'backup.failed';
      webhooks.emit(eventType, {
        id: jobId,
        name: jobData.name,
        type: backupType,
        status: result.success ? 'completed' : 'failed',
        size: result.size || 0,
        file: result.file || null,
        error: result.error || null,
        completedAt: new Date().toISOString(),
      });

      if (result.success) {
        await pruneBackups(job);
      }

      if (global.io) {
        global.io.emit('jobCompleted', { id: jobId, name: jobData.name, status: result.success ? 'completed' : 'failed' });
        global.io.emit('queueStats', await backupQueue.getStats());
      }

      return result;
    } catch (e) {
      await db.run('UPDATE backups SET status = ?, error = ? WHERE id = ?', 'failed', e.message, jobId);
      const errMsg = `Backup error: ${jobData.name} - ${e.message}`;
      await addLog(errMsg, 'error');
      await sendNotification(errMsg, 'error');

      if (global.io) {
        global.io.emit('jobFailed', { id: jobId, name: jobData.name, error: e.message });
        global.io.emit('queueStats', await backupQueue.getStats());
      }
      throw e;
    }
};

module.exports = { executeBackup, executeBackupInternal, pruneBackups };
