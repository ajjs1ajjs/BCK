const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const { db } = require('../services/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { addLog } = require('../services/helpers');
const { SALT_ROUNDS } = require('../services/config');

// GET /api/users
router.get('/users', authorize('manageUsers'), async (req, res) => {
  const users = db.prepare('SELECT id, username, role, email, active, createdAt FROM users').all();
  res.json(users);
});

// POST /api/users
router.post('/users', authorize('manageUsers'), async (req, res) => {
  const v = validate('createUser', req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { username, password, role, email } = v.data;
  
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(400).json({ error: 'Username exists' });
  }
  
  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { id: uuidv4(), username, password: hashed, role, email: email || '', active: 1, createdAt: new Date().toISOString() };
  
  try {
    db.prepare('INSERT INTO users (id, username, password, role, email, active, createdAt) VALUES (@id, @username, @password, @role, @email, @active, @createdAt)')
      .run(user);
    await addLog(`User created: ${username}`, 'success');
    res.status(201).json({ ...user, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

// PUT /api/users/:id
router.put('/users/:id', authorize('manageUsers'), async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...user, ...req.body };
  if (req.body.password && req.body.password !== '***') {
    update.password = await bcrypt.hash(req.body.password, SALT_ROUNDS);
  }
  update.active = update.active ? 1 : 0;
  
  try {
    db.prepare('UPDATE users SET username = @username, password = @password, role = @role, email = @email, active = @active WHERE id = @id')
      .run(update);
    await addLog(`User updated: ${update.username}`, 'info');
    res.json({ ...update, password: '***' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

// DELETE /api/users/:id
router.delete('/users/:id', authorize('manageUsers'), async (req, res) => {
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    await addLog(`User deleted: ${user.username}`, 'warning');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

module.exports = router;
