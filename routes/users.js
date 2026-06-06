const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const { db } = require('../services/db');
const { authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { sensitiveApiLimiter } = require('../middleware/rateLimit');
const { addLog } = require('../services/helpers');
const { SALT_ROUNDS } = require('../services/config');

// GET /api/users
router.get('/users', authorize('manageUsers'), async (req, res) => {
  const users = await db.all('SELECT id, username, role, email, active, createdAt FROM users');
  res.json(users);
});

// POST /api/users
router.post('/users', sensitiveApiLimiter, authorize('manageUsers'), async (req, res) => {
  const v = validate('createUser', req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { username, password, role, email } = v.data;
  
  if (await db.get('SELECT id FROM users WHERE username = ?', username)) {
    return res.status(400).json({ error: 'Username exists' });
  }
  
  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { id: uuidv4(), username, password: hashed, role, email: email || '', active: 1, createdAt: new Date().toISOString() };
  
  try {
    await db.run('INSERT INTO users (id, username, password, role, email, active, createdAt) VALUES (@id, @username, @password, @role, @email, @active, @createdAt)', user);
    await addLog(`User created: ${username}`, 'success');
    res.status(201).json({ ...user, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

// PUT /api/users/:id
router.put('/users/:id', sensitiveApiLimiter, authorize('manageUsers'), async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...user, ...req.body };
  if (req.body.password && req.body.password !== '***') {
    update.password = await bcrypt.hash(req.body.password, SALT_ROUNDS);
  }
  update.active = update.active ? 1 : 0;
  
  try {
    await db.run('UPDATE users SET username = @username, password = @password, role = @role, email = @email, active = @active WHERE id = @id', update);
    await addLog(`User updated: ${update.username}`, 'info');
    res.json({ ...update, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

// DELETE /api/users/:id
router.delete('/users/:id', sensitiveApiLimiter, authorize('manageUsers'), async (req, res) => {
  const user = await db.get('SELECT username FROM users WHERE id = ?', req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  try {
    await db.run('DELETE FROM users WHERE id = ?', req.params.id);
    await addLog(`User deleted: ${user.username}`, 'warning');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

module.exports = router;
