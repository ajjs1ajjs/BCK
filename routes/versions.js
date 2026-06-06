const express = require('express');
const router = express.Router();
const { db } = require('../services/db');
const { authorize } = require('../middleware/auth');
const cryptoHelper = require('../services/crypto');
const s3versions = require('../services/s3versions');
const { addLog } = require('../services/helpers');

// Helper to decrypt credentials
async function getDecryptedCred(cloudCredentialId) {
  const credRaw = await db.get('SELECT * FROM cloud_credentials WHERE id = ?', cloudCredentialId);
  if (!credRaw) return null;
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
  return cred;
}

// GET /api/versions/:backupId
router.get('/versions/:backupId', authorize('viewLogs'), async (req, res) => {
  const backup = await db.get('SELECT * FROM backups WHERE id = ?', req.params.backupId);
  if (!backup) return res.status(404).json({ error: 'Backup job not found' });

  if (backup.orgId !== req.user.orgId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const jobConfig = JSON.parse(backup.config || '{}');
  const cloudCredentialId = jobConfig.cloudCredentialId;
  if (!cloudCredentialId) {
    return res.status(400).json({ error: 'This backup is not configured for cloud storage' });
  }

  const cred = await getDecryptedCred(cloudCredentialId);
  if (!cred) {
    return res.status(404).json({ error: 'Cloud credentials not found' });
  }

  const backupType = backup.backupType || backup.type;
  let key = '';
  if (backupType === 'cloud') {
    key = backup.destination;
  } else {
    key = backup.resultFile ? require('path').basename(backup.resultFile) : '';
  }

  if (!key) {
    return res.status(400).json({ error: 'No backup file has been generated yet for this job' });
  }

  // Also check if versioning is enabled on this bucket/endpoint
  const statusRes = await s3versions.getVersioningStatus(cred);
  const versionRes = await s3versions.listVersions(cred, key);

  if (!versionRes.success) {
    return res.status(500).json({ error: versionRes.error });
  }

  res.json({
    versioningEnabled: statusRes.enabled,
    versioningStatus: statusRes.status || 'Disabled',
    versions: versionRes.versions,
  });
});

// POST /api/versions/:backupId/enable
router.post('/versions/:backupId/enable', authorize('configure'), async (req, res) => {
  const backup = await db.get('SELECT * FROM backups WHERE id = ?', req.params.backupId);
  if (!backup) return res.status(404).json({ error: 'Backup job not found' });

  if (backup.orgId !== req.user.orgId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const jobConfig = JSON.parse(backup.config || '{}');
  const cloudCredentialId = jobConfig.cloudCredentialId;
  if (!cloudCredentialId) {
    return res.status(400).json({ error: 'This backup is not configured for cloud storage' });
  }

  const cred = await getDecryptedCred(cloudCredentialId);
  if (!cred) {
    return res.status(404).json({ error: 'Cloud credentials not found' });
  }

  const result = await s3versions.enableVersioning(cred);
  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  await addLog(`S3 versioning enabled for bucket: ${cred.credentials.bucket}`, 'info');
  res.json({ success: true, message: 'Versioning enabled' });
});

// POST /api/versions/:id/restore — restore a specific version
router.post('/versions/:id/restore', authorize('restore'), async (req, res) => {
  const { versionId, targetType, config } = req.body;
  if (!versionId) return res.status(400).json({ error: 'versionId is required' });

  // Verify backup job exists
  const backup = await db.get('SELECT * FROM backups WHERE id = ?', req.params.id);
  if (!backup) return res.status(404).json({ error: 'Backup job not found' });

  if (backup.orgId !== req.user.orgId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Forward to /api/restore
  req.url = '/restore';
  req.body = {
    backupId: req.params.id,
    targetType: targetType || 'original',
    config: {
      ...(config || {}),
      versionId
    }
  };
  return req.app._router.handle(req, res);
});

module.exports = router;
