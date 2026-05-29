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
const { authLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validation');

// POST /api/login
router.post('/login', authLimiter, async (req, res) => {
  const v = validate('login', req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { username, password } = v.data;
  
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
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

  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role);
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
});

// POST /api/login/2fa
router.post('/login/2fa', authLimiter, async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) return res.status(400).json({ error: 'Token and code required' });

  try {
    const decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.partial) throw new Error('Invalid token type');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user || !user.twoFactorEnabled) return res.status(401).json({ error: 'Invalid session' });

    const isValid = authenticator.verify({
      token: code,
      secret: cryptoHelper.decrypt(user.twoFactorSecret)
    });

    if (!isValid) return res.status(401).json({ error: 'Invalid 2FA code' });

    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role);
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
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// POST /api/users/2fa/setup
router.post('/users/2fa/setup', authenticate, async (req, res) => {
  const secret = authenticator.generateSecret();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
  const otpauth = authenticator.keyuri(user.username, 'BCK-Backup', secret);
  
  try {
    const qrCodeUrl = await qrcode.toDataURL(otpauth);
    // Secure fix: Save the secret as pending in the database immediately rather than relying on client return
    db.prepare('UPDATE users SET twoFactorSecret = ?, twoFactorEnabled = 0 WHERE id = ?')
      .run(cryptoHelper.encrypt(secret), req.user.id);
    
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
    const user = db.prepare('SELECT twoFactorSecret, username FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.twoFactorSecret) return res.status(400).json({ error: '2FA setup has not been initiated' });

    const secret = cryptoHelper.decrypt(user.twoFactorSecret);
    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) return res.status(400).json({ error: 'Invalid verification code' });

    db.prepare('UPDATE users SET twoFactorEnabled = 1 WHERE id = ?')
      .run(req.user.id);
    await addLog(`User ${user.username} enabled 2FA`, 'info');
    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

// POST /api/users/2fa/disable
router.post('/users/2fa/disable', authenticate, async (req, res) => {
  try {
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
    db.prepare('UPDATE users SET twoFactorSecret = NULL, twoFactorEnabled = 0 WHERE id = ?')
      .run(req.user.id);
    await addLog(`User ${user ? user.username : req.user.id} disabled 2FA`, 'warning');
    res.json({ success: true, message: '2FA disabled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router;
