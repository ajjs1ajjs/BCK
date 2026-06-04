const { db } = require('../db');
const cloudService = require('../cloud');
const cryptoHelper = require('../crypto');

class CloudStrategy {
  async _getCreds(cloudCredentialId) {
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

  async backup(job) {
    const cred = await this._getCreds(job.config?.cloudCredentialId);
    if (!cred) {
      return { success: false, error: 'Cloud credentials not found' };
    }
    const uploadRes = await cloudService.upload(cred, job.source, job.destination);
    return { success: uploadRes.success, file: uploadRes.url || job.source, error: uploadRes.error || null };
  }

  async restore(job, config, restoreFile, targetType) {
    const cred = await this._getCreds(job.config?.cloudCredentialId);
    if (!cred) {
      return { success: false, error: 'Cloud credentials not found' };
    }
    
    const localDest = targetType === 'original' ? job.destination : (config?.localPath || job.destination);
    let downloadRes;
    if (config?.versionId) {
      const s3versions = require('../s3versions');
      downloadRes = await s3versions.restoreVersion(cred, job.destination, config.versionId, localDest);
    } else {
      downloadRes = await cloudService.download(cred, job.destination, localDest);
    }
    return { success: downloadRes.success, error: downloadRes.error };
  }
}

module.exports = new CloudStrategy();
