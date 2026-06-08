const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');

const { db } = require('../services/db');
const { JWT_SECRET } = require('../services/config');
const cryptoHelper = require('../services/crypto');
const { addLog } = require('../services/helpers');
const { authenticate } = require('../middleware/auth');
const { authLimiter, loginLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validation');

// POST /api/login
router.post('/login', loginLimiter, async (req, res) => {
  const v = validate('login', req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { username, password } = v.data;
  
  const user = await db.get('SELECT * FROM users WHERE username = ? AND active = 1', username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  
  // Check for 2FA
  if (user.twoFactorEnabled) {
    const tempToken = jwt.sign(
      { id: user.id, partial: true },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    return res.json({ requires2FA: true, tempToken });
  }

  const role = await db.get('SELECT * FROM roles WHERE id = ?', user.role);
  const permissions = role ? JSON.parse(role.permissions) : {};
  
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, permissions },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
  });

  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  await addLog(`User "${user.username}" logged in from ${ip}`, 'info');
  res.json({ token, username: user.username, role: user.role, permissions });
});

// POST /api/login/2fa
router.post('/login/2fa', authLimiter, async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) return res.status(400).json({ error: 'Token and code required' });

  try {
    const decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.partial) throw new Error('Invalid token type');

    const user = await db.get('SELECT * FROM users WHERE id = ?', decoded.id);
    if (!user || !user.twoFactorEnabled) return res.status(401).json({ error: 'Invalid session' });

    const isValid = authenticator.verify({
      token: code,
      secret: cryptoHelper.decrypt(user.twoFactorSecret)
    });

    if (!isValid) return res.status(401).json({ error: 'Invalid 2FA code' });

    const role = await db.get('SELECT * FROM roles WHERE id = ?', user.role);
    const permissions = role ? JSON.parse(role.permissions) : {};
    
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, permissions },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });
    
    res.json({ token, username: user.username, role: user.role, permissions });
  } catch (e) {
    res.status(401).json({ error: 'Session expired or invalid' });
  }
});

// POST /api/logout
router.post('/logout', authenticate, async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  await addLog(`User "${req.user?.username || 'unknown'}" logged out from ${ip}`, 'info');
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// POST /api/users/2fa/setup
router.post('/users/2fa/setup', authenticate, async (req, res) => {
  const secret = authenticator.generateSecret();
  const user = await db.get('SELECT username FROM users WHERE id = ?', req.user.id);
  const otpauth = authenticator.keyuri(user.username, 'BCK-Backup', secret);
  
  try {
    const qrCodeUrl = await qrcode.toDataURL(otpauth);
    // Secure fix: Save the secret as pending in the database immediately rather than relying on client return
    await db.run('UPDATE users SET twoFactorSecret = ?, twoFactorEnabled = 0 WHERE id = ?', cryptoHelper.encrypt(secret), req.user.id);
    
    res.json({ secret, qrCodeUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// POST /api/users/2fa/verify
router.post('/users/2fa/verify', authenticate, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  try {
    const user = await db.get('SELECT twoFactorSecret, username FROM users WHERE id = ?', req.user.id);
    if (!user || !user.twoFactorSecret) return res.status(400).json({ error: '2FA setup has not been initiated' });

    const secret = cryptoHelper.decrypt(user.twoFactorSecret);
    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) return res.status(400).json({ error: 'Invalid verification code' });

    await db.run('UPDATE users SET twoFactorEnabled = 1 WHERE id = ?', req.user.id);
    await addLog(`User ${user.username} enabled 2FA`, 'info');
    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

// POST /api/users/2fa/disable
router.post('/users/2fa/disable', authenticate, async (req, res) => {
  try {
    const user = await db.get('SELECT username FROM users WHERE id = ?', req.user.id);
    await db.run('UPDATE users SET twoFactorSecret = NULL, twoFactorEnabled = 0 WHERE id = ?', req.user.id);
    await addLog(`User ${user ? user.username : req.user.id} disabled 2FA`, 'warning');
    res.json({ success: true, message: '2FA disabled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /api/auth/ldap — LDAP/Active Directory login
router.post('/auth/ldap', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const { getSettings } = require('../services/helpers');
    const settings = await getSettings();
    const ldapConfig = settings.ldap;

    if (!ldapConfig || !ldapConfig.enabled) {
      return res.status(400).json({ error: 'LDAP authentication is not enabled' });
    }

    const ldapService = require('../services/ldap');
    const result = await ldapService.authenticate(ldapConfig, username, password);

    if (!result.success) {
      return res.status(401).json({ error: result.error || 'LDAP authentication failed' });
    }

    const { user: ldapUser } = result;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    // Find or auto-provision local user record from LDAP data
    let localUser = await db.get('SELECT * FROM users WHERE ldapDn = ? OR username = ?', ldapUser.ldapDn, ldapUser.username);

    if (!localUser) {
      // Auto-provision LDAP user
      const { v4: uuidv4 } = require('uuid');
      const bcrypt = require('bcryptjs');
      const { SALT_ROUNDS } = require('../services/config');
      const newId = uuidv4();
      const tempPw = await bcrypt.hash(uuidv4(), SALT_ROUNDS); // unusable local password

      await db.run(`
        INSERT INTO users (id, username, password, role, email, active, ldapDn, authProvider, createdAt)
        VALUES (?, ?, ?, ?, ?, 1, ?, 'ldap', ?)
      `, newId, ldapUser.username, tempPw, ldapUser.role, ldapUser.email, ldapUser.ldapDn, new Date().toISOString());

      localUser = await db.get('SELECT * FROM users WHERE id = ?', newId);
      await addLog(`LDAP user auto-provisioned: ${ldapUser.username}`, 'info');
    } else {
      // Update role from LDAP group mapping on every login
      await db.run('UPDATE users SET role = ?, email = ?, active = 1 WHERE id = ?', ldapUser.role, ldapUser.email || localUser.email, localUser.id);
    }

    const role = await db.get('SELECT * FROM roles WHERE id = ?', localUser.role || ldapUser.role);
    const permissions = role ? JSON.parse(role.permissions) : {};

    const token = jwt.sign(
      { id: localUser.id, username: localUser.username, role: localUser.role || ldapUser.role, permissions },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });

    await addLog(`LDAP user "${ldapUser.username}" logged in from ${ip}`, 'info');
    res.json({ token, username: localUser.username, role: localUser.role, permissions });
  } catch (err) {
    res.status(500).json({ error: 'LDAP login error: ' + err.message });
  }
});

// POST /api/auth/ldap/test — test LDAP connection (admin only)
router.post('/auth/ldap/test', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const ldapService = require('../services/ldap');
    const result = await ldapService.testConnection(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

