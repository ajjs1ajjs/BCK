const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { db } = require('../services/db');
const { authorize } = require('../middleware/auth');
const { addLog } = require('../services/helpers');

// GET /api/organizations
router.get('/organizations', authorize('manageUsers'), async (req, res) => {
  const orgs = db.prepare('SELECT * FROM organizations ORDER BY createdAt ASC').all();
  // Annotate with user count per org
  const result = orgs.map(org => {
    const userCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE orgId = ?").get(org.id)?.cnt || 0;
    return { ...org, userCount };
  });
  res.json(result);
});

// POST /api/organizations
router.post('/organizations', authorize('manageUsers'), async (req, res) => {
  const { name, slug } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase letters, numbers, and hyphens only' });

  const exists = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
  if (exists) return res.status(400).json({ error: 'Organization slug already exists' });

  const org = { id: uuidv4(), name, slug, createdAt: new Date().toISOString() };
  try {
    db.prepare('INSERT INTO organizations (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run(org.id, org.name, org.slug, org.createdAt);
    await addLog(`Organization created: ${name} [${slug}]`, 'success');
    res.status(201).json(org);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create organization: ' + err.message });
  }
});

// PUT /api/organizations/:id
router.put('/organizations/:id', authorize('manageUsers'), async (req, res) => {
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Not found' });
  if (req.params.id === 'default') return res.status(400).json({ error: 'Cannot modify default organization' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(name, req.params.id);
    await addLog(`Organization updated: ${name}`, 'info');
    res.json({ ...org, name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

// DELETE /api/organizations/:id
router.delete('/organizations/:id', authorize('manageUsers'), async (req, res) => {
  if (req.params.id === 'default') return res.status(400).json({ error: 'Cannot delete default organization' });

  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Not found' });

  // Move users to default before deleting
  db.prepare("UPDATE users SET orgId = 'default' WHERE orgId = ?").run(req.params.id);

  try {
    db.prepare('DELETE FROM organizations WHERE id = ?').run(req.params.id);
    await addLog(`Organization deleted: ${org.name}`, 'warning');
    res.json({ message: 'Deleted, users moved to default organization' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

module.exports = router;
