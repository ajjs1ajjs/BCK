const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { db } = require('../services/db');
const { authenticate, authorize } = require('../middleware/auth');
const { addLog } = require('../services/helpers');

// Hash a raw token for secure storage
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Generate a secure random API token (prefix bck_)
function generateRawToken() {
  return 'bck_' + crypto.randomBytes(32).toString('hex');
}

// GET /api/tokens — list own tokens (admin sees all)
router.get('/tokens', async (req, res) => {
  const tokens = req.user.role === 'admin'
    ? await db.all('SELECT id, name, userId, orgId, permissions, lastUsedAt, expiresAt, createdAt FROM api_tokens ORDER BY createdAt DESC')
    : await db.all('SELECT id, name, userId, orgId, permissions, lastUsedAt, expiresAt, createdAt FROM api_tokens WHERE userId = ? ORDER BY createdAt DESC', req.user.id);
  res.json(tokens.map(t => ({ ...t, permissions: JSON.parse(t.permissions || '{}') })));
});

// POST /api/tokens — create new token
router.post('/tokens', async (req, res) => {
  const { name, permissions, expiresAt } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Token name is required' });

  const raw = generateRawToken();
  const hashed = hashToken(raw);
  const id = uuidv4();
  const now = new Date().toISOString();
  const perms = permissions || {};

  // Respect requester's own permissions (can't grant more than you have)
  const effectivePerms = req.user.role === 'admin' ? perms : Object.fromEntries(
    Object.entries(perms).filter(([k]) => req.user.permissions?.[k])
  );

  try {
    await db.prepare(`
      INSERT INTO api_tokens (id, name, tokenHash, userId, orgId, permissions, lastUsedAt, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(id, name.trim(), hashed, req.user.id, req.user.orgId || 'default', JSON.stringify(effectivePerms), expiresAt || null, now);

    await addLog(`API token created: "${name}" by ${req.user.username}`, 'info');

    // Return the raw token ONCE — it will never be shown again
    res.status(201).json({
      id, name, token: raw,
      permissions: effectivePerms,
      expiresAt: expiresAt || null,
      createdAt: now,
      warning: 'Save this token now — it will not be shown again.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create token: ' + err.message });
  }
});

// DELETE /api/tokens/:id — revoke token
router.delete('/tokens/:id', async (req, res) => {
  const token = await db.get('SELECT * FROM api_tokens WHERE id = ?', req.params.id);
  if (!token) return res.status(404).json({ error: 'Not found' });

  // Only owner or admin can revoke
  if (token.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    await db.run('DELETE FROM api_tokens WHERE id = ?', req.params.id);
    await addLog(`API token revoked: "${token.name}" by ${req.user.username}`, 'warning');
    res.json({ message: 'Token revoked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke token: ' + err.message });
  }
});

module.exports = router;
