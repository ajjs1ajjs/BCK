const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fsSync = require('fs');

const { db } = require('../services/db');
const cryptoHelper = require('../services/crypto');
const dbService = require('../services/database');
const sshService = require('../services/ssh');
const cloudService = require('../services/cloud');

const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { addLog } = require('../services/helpers');

const SSH_KEYS_DIR = path.join(__dirname, '..', 'data', 'ssh_keys');

function writeSshKey(id, keyContent) {
  if (!keyContent) return '';
  const dir = SSH_KEYS_DIR;
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, `${id}.pem`);
  fsSync.writeFileSync(keyPath, keyContent, 'utf8');
  fsSync.chmodSync(keyPath, 0o600);
  return keyPath;
}

function deleteSshKey(keyPath) {
  if (!keyPath) return;
  try { fsSync.unlinkSync(keyPath); } catch (e) { console.error('Failed to delete SSH key:', e.message); }
}

// ─── Database Connections ───────────────────────────────────────────────────

router.get('/db-connections', async (req, res) => {
  const items = db.prepare('SELECT * FROM db_connections').all();
  res.json(items.map(c => ({ ...c, password: c.password ? '***' : '' })));
});

router.post('/db-connections', authorize('manageBackups'), async (req, res) => {
  const v = validate('dbConnection', req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, type, host, port, user, password, database } = v.data;
  const defaultPorts = { mysql: 3306, postgres: 5432, oracle: 1521, mongodb: 27017, mssql: 1433, redis: 6379 };
  const finalPort = port || defaultPorts[type] || 3306;
  const conn = { id: uuidv4(), name, type, host, port: finalPort, user, password: cryptoHelper.encrypt(password || ''), database: database || '' };
  
  try {
    db.prepare('INSERT INTO db_connections (id, name, type, host, port, user, password, database) VALUES (@id, @name, @type, @host, @port, @user, @password, @database)')
      .run(conn);
    res.status(201).json({ ...conn, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

router.put('/db-connections/:id', authorize('manageBackups'), async (req, res) => {
  const conn = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...conn, ...req.body };
  if (req.body.password && req.body.password !== '***') {
    update.password = cryptoHelper.encrypt(req.body.password);
  }
  
  const defaultPorts = { mysql: 3306, postgres: 5432, oracle: 1521, mongodb: 27017, mssql: 1433, redis: 6379 };
  const finalType = req.body.type || conn.type;
  const portInput = req.body.hasOwnProperty('port') ? req.body.port : conn.port;
  update.port = portInput || defaultPorts[finalType] || 3306;
  
  try {
    db.prepare('UPDATE db_connections SET name = @name, type = @type, host = @host, port = @port, user = @user, password = @password, database = @database WHERE id = @id')
      .run(update);
    res.json({ ...update, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

router.delete('/db-connections/:id', authorize('manageBackups'), async (req, res) => {
  try {
    db.prepare('DELETE FROM db_connections WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

router.post('/db-connections/:id/test', authorize('manageBackups'), async (req, res) => {
  const connRaw = db.prepare('SELECT * FROM db_connections WHERE id = ?').get(req.params.id);
  if (!connRaw) return res.status(404).json({ error: 'Not found' });
  const conn = { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) };
  try {
    const dbs = await dbService.listDatabases(conn.type, conn);
    res.json({ success: true, databases: dbs });
  } catch (err) {
    res.json({ success: false, error: err.message, databases: [] });
  }
});

// ─── SSH Connections ────────────────────────────────────────────────────

router.get('/ssh-connections', async (req, res) => {
  const items = db.prepare('SELECT * FROM ssh_connections').all();
  res.json(items.map(c => ({ ...c, password: c.password ? '***' : '', key: c.key ? '***' : '' })));
});

router.post('/ssh-connections', authorize('manageBackups'), async (req, res) => {
  const v = validate('sshConnection', req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, host, port, user, password, key } = v.data;
  const id = uuidv4();
  const keyPath = writeSshKey(id, key);
  const conn = { id, name, host, port: port || 22, user, password: cryptoHelper.encrypt(password || ''), key: keyPath || '', createdAt: new Date().toISOString() };
  
  try {
    db.prepare('INSERT INTO ssh_connections (id, name, host, port, user, password, key, createdAt) VALUES (@id, @name, @host, @port, @user, @password, @key, @createdAt)')
      .run(conn);
    await addLog(`SSH connection added: ${name}`, 'success');
    res.status(201).json({ ...conn, password: '***', key: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

router.put('/ssh-connections/:id', authorize('manageBackups'), async (req, res) => {
  const conn = db.prepare('SELECT * FROM ssh_connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...conn, ...req.body };
  if (req.body.password && req.body.password !== '***') {
    update.password = cryptoHelper.encrypt(req.body.password);
  }
  if (req.body.key && req.body.key !== '***') {
    deleteSshKey(conn.key);
    update.key = writeSshKey(conn.id, req.body.key);
  }
  
  try {
    db.prepare('UPDATE ssh_connections SET name = @name, host = @host, port = @port, user = @user, password = @password, key = @key WHERE id = @id')
      .run(update);
    await addLog(`SSH connection updated: ${update.name}`, 'info');
    res.json({ ...update, password: '***', key: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

router.delete('/ssh-connections/:id', authorize('manageBackups'), async (req, res) => {
  const conn = db.prepare('SELECT * FROM ssh_connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  deleteSshKey(conn.key);
  try {
    db.prepare('DELETE FROM ssh_connections WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

router.post('/ssh-connections/:id/test', authorize('manageBackups'), async (req, res) => {
  const connRaw = db.prepare('SELECT * FROM ssh_connections WHERE id = ?').get(req.params.id);
  if (!connRaw) return res.status(404).json({ error: 'Not found' });
  const conn = { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) };
  try {
    const r = await sshService.exec(conn, 'echo BCK_CONNECTED && hostname');
    res.json({ success: r.success, hostname: r.stdout || null, error: r.stderr || null });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ─── Cloud Credentials ──────────────────────────────────────────────────

// Helper to test cloud connectivity before saving credentials
async function diagnoseCloud(provider, encryptedCreds) {
  // Decrypt credentials similar to test route
  const credCopy = { ...encryptedCreds };
  ['secretAccessKey', 'accessKey', 'password', 'credentials'].forEach(k => {
    if (credCopy[k]) {
      try {
        const dec = cryptoHelper.decrypt(credCopy[k]);
        if (k === 'credentials') {
          try { credCopy[k] = JSON.parse(dec); } catch { credCopy[k] = dec; }
        } else {
          credCopy[k] = dec;
        }
      } catch (e) {
        // ignore decryption errors, will be caught later
      }
    }
  });
  const toolCheck = cloudService.checkTools(provider);
  if (!toolCheck.available) return { success: false, error: `${provider} CLI not installed` };
  try {
    await cloudService.list({ provider, credentials: credCopy }, '');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

router.get('/cloud-credentials', async (req, res) => {
  const items = db.prepare('SELECT * FROM cloud_credentials').all();
  res.json(items.map(c => ({ ...c, credentials: { ...JSON.parse(c.credentials), secretAccessKey: '***', accessKey: '***', password: '***' } })));
});

router.post('/cloud-credentials', authorize('manageBackups'), async (req, res) => {
  const v = validate('cloudCredential', req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, provider, credentials } = v.data;

  const encryptedCredentials = { ...credentials };
  if (encryptedCredentials.secretAccessKey) encryptedCredentials.secretAccessKey = cryptoHelper.encrypt(encryptedCredentials.secretAccessKey);
  if (encryptedCredentials.accessKey) encryptedCredentials.accessKey = cryptoHelper.encrypt(encryptedCredentials.accessKey);
  if (encryptedCredentials.password) encryptedCredentials.password = cryptoHelper.encrypt(encryptedCredentials.password);
  if (encryptedCredentials.credentials) {
    if (typeof encryptedCredentials.credentials === 'object') {
      encryptedCredentials.credentials = cryptoHelper.encrypt(JSON.stringify(encryptedCredentials.credentials));
    } else {
      encryptedCredentials.credentials = cryptoHelper.encrypt(encryptedCredentials.credentials);
    }
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  
  // Validate cloud connection before saving
  const diag = await diagnoseCloud(provider, encryptedCredentials);
  if (!diag.success) {
    return res.status(400).json({ error: 'Cloud diagnostics failed: ' + diag.error });
  }

  try {
    db.prepare('INSERT INTO cloud_credentials (id, name, provider, credentials, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, provider, JSON.stringify(encryptedCredentials), now);
    await addLog(`Cloud credentials added: ${name} [${provider}]`, 'success');
    res.status(201).json({ id, name, provider, credentials: { ...credentials, secretAccessKey: '***', accessKey: '***', password: '***' } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

router.put('/cloud-credentials/:id', authorize('manageBackups'), async (req, res) => {
  const curr = db.prepare('SELECT * FROM cloud_credentials WHERE id = ?').get(req.params.id);
  if (!curr) return res.status(404).json({ error: 'Not found' });
  
  const { credentials, name } = req.body;
  let finalCreds = JSON.parse(curr.credentials);
  
  if (credentials) {
    for (const [k, v] of Object.entries(credentials)) {
      if (v !== '***') {
        if (['secretAccessKey', 'accessKey', 'password'].includes(k)) {
          finalCreds[k] = cryptoHelper.encrypt(v);
        } else if (k === 'credentials') {
          finalCreds[k] = cryptoHelper.encrypt(typeof v === 'object' ? JSON.stringify(v) : v);
        } else {
          finalCreds[k] = v;
        }
      }
    }
  }
  
  // Validate cloud connection before updating
  const diagUpdate = await diagnoseCloud(curr.provider, finalCreds);
  if (!diagUpdate.success) {
    return res.status(400).json({ error: 'Cloud diagnostics failed: ' + diagUpdate.error });
  }

  try {
    db.prepare('UPDATE cloud_credentials SET name = ?, credentials = ? WHERE id = ?')
      .run(name || curr.name, JSON.stringify(finalCreds), req.params.id);
    res.json({ id: curr.id, name: name || curr.name, provider: curr.provider, credentials: { ...finalCreds, secretAccessKey: '***', accessKey: '***', password: '***' } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

router.delete('/cloud-credentials/:id', authorize('manageBackups'), async (req, res) => {
  try {
    db.prepare('DELETE FROM cloud_credentials WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

router.post('/cloud-credentials/:id/test', authorize('manageBackups'), async (req, res) => {
  const credRaw = db.prepare('SELECT * FROM cloud_credentials WHERE id = ?').get(req.params.id);
  if (!credRaw) return res.status(404).json({ error: 'Not found' });

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

  const toolCheck = cloudService.checkTools(cred.provider);
  if (!toolCheck.available) return res.json({ success: false, error: `${cred.provider} CLI not installed` });
  try {
    const result = await cloudService.list({ provider: cred.provider, credentials: cred.credentials }, '');
    res.json({ success: true, message: `Connected. Found ${result.length} objects.` });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
