const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');

const { db } = require('./db');
const cryptoHelper = require('./crypto');
const cloudService = require('./cloud');
const { addLog, sendNotification } = require('./helpers');
const StrategyFactory = require('./strategy/StrategyFactory');

const executeRestore = async (backupId, targetType, config) => {
  const b = await db.get('SELECT * FROM backups WHERE id = ?', backupId);
  if (!b) throw new Error('Backup not found');
  const job = { ...b, config: JSON.parse(b.config) };

  await addLog(`Restore started: ${job.name}`, 'info');

  // Run asynchronously in background
  (async () => {
    let tempDownloadedFile = null;
    let tempDecryptedFile = null;
    try {
      const backupType = job.backupType || job.type;
      let restoreFile = job.resultFile || config?.file;

      // 1. Download from Cloud if necessary
      if (job.config?.cloudCredentialId && restoreFile && backupType !== 'cloud') {
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
          const tempFile = path.join(os.tmpdir(), path.basename(restoreFile || 'restore.bak'));
          let downloadRes;
          if (config?.versionId) {
            const s3versions = require('./s3versions');
            downloadRes = await s3versions.restoreVersion(cred, path.basename(restoreFile), config.versionId, tempFile);
          } else {
            downloadRes = await cloudService.download(cred, path.basename(restoreFile), tempFile);
          }
          if (downloadRes.success) {
            restoreFile = tempFile;
            tempDownloadedFile = tempFile;
          } else {
            throw new Error(`Failed to download backup file from cloud: ${downloadRes.error}`);
          }
        }
      }

      // 2. Decrypt if needed
      if (restoreFile && (restoreFile.endsWith('.enc') || job.config?.encryption) && backupType !== 'cloud') {
        tempDecryptedFile = path.join(os.tmpdir(), path.basename(restoreFile).replace(/\.enc$/, ''));
        try {
          await cryptoHelper.decryptFile(restoreFile, tempDecryptedFile, job.config?.encryptionPassword);
          restoreFile = tempDecryptedFile;
        } catch (e) {
          throw new Error(`Failed to decrypt backup file: ${e.message}`);
        }
      }

      // 3. Delegate to Strategy
      const strategy = StrategyFactory.getStrategy(backupType);
      const result = await strategy.restore(job, config, restoreFile, targetType);

      // Cleanup temp files
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
      // Cleanup temp files on error
      if (tempDownloadedFile) {
        try { await fs.unlink(tempDownloadedFile); } catch (e) {}
      }
      if (tempDecryptedFile) {
        try { await fs.unlink(tempDecryptedFile); } catch (e) {}
      }

      const errMsg = `Restore error: ${job.name} - ${e.message}`;
      await addLog(errMsg, 'error');
      await sendNotification(errMsg, 'error');
    }
  })();
};

module.exports = { executeRestore };
