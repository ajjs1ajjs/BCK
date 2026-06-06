const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { db } = require('../services/db');
const { authorize } = require('../middleware/auth');
const { sensitiveApiLimiter } = require('../middleware/rateLimit');
const { addLog } = require('../services/helpers');

// GET /api/roles
router.get('/roles', authorize('manageRoles'), async (req, res) => {
  const roles = await db.all('SELECT * FROM roles');
  res.json(roles.map(r => ({ ...r, permissions: JSON.parse(r.permissions) })));
});

// POST /api/roles
router.post('/roles', sensitiveApiLimiter, authorize('manageRoles'), async (req, res) => {
  const { name, description, permissions } = req.body;
  if (!name || !permissions) return res.status(400).json({ error: 'Name and permissions required' });
  const role = { id: uuidv4(), name, description: description || '', level: 1, permissions: JSON.stringify(permissions) };
  
  try {
    await db.run('INSERT INTO roles (id, name, description, level, permissions) VALUES (@id, @name, @description, @level, @permissions)', role);
    await addLog(`Role created: ${name}`, 'success');
    res.status(201).json({ ...role, permissions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

// PUT /api/roles/:id
router.put('/roles/:id', sensitiveApiLimiter, authorize('manageRoles'), async (req, res) => {
  const role = await db.get('SELECT * FROM roles WHERE id = ?', req.params.id);
  if (!role) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...role, ...req.body };
  if (req.body.permissions) update.permissions = JSON.stringify(req.body.permissions);
  
  try {
    await db.run('UPDATE roles SET name = @name, description = @description, level = @level, permissions = @permissions WHERE id = @id', update);
    await addLog(`Role updated: ${update.name}`, 'info');
    res.json({ ...update, permissions: JSON.parse(update.permissions) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

// DELETE /api/roles/:id
router.delete('/roles/:id', sensitiveApiLimiter, authorize('manageRoles'), async (req, res) => {
  try {
    await db.run('DELETE FROM roles WHERE id = ?', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

module.exports = router;
