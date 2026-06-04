const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { db } = require('../services/db');
const { authorize } = require('../middleware/auth');
const { addLog } = require('../services/helpers');

// GET /api/organizations
router.get('/organizations', authorize('manageUsers'), async (req, res) => {
  const orgs = await db.all('SELECT * FROM organizations ORDER BY createdAt ASC');
  // Annotate with user count per org
  const result = orgs.map(async org => {
    const userCount = (await db.get("SELECT COUNT(*) as cnt FROM users WHERE orgId = ?", org.id))?.cnt || 0;
    return { ...org, userCount };
  });
  res.json(result);
});

// POST /api/organizations
router.post('/organizations', authorize('manageUsers'), async (req, res) => {
  const { name, slug } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase letters, numbers, and hyphens only' });

  const exists = await db.get('SELECT id FROM organizations WHERE slug = ?', slug);
  if (exists) return res.status(400).json({ error: 'Organization slug already exists' });

  const org = { id: uuidv4(), name, slug, createdAt: new Date().toISOString() };
  try {
    await db.run('INSERT INTO organizations (id, name, slug, createdAt) VALUES (?, ?, ?, ?)', org.id, org.name, org.slug, org.createdAt);
    await addLog(`Organization created: ${name} [${slug}]`, 'success');
    res.status(201).json(org);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create organization: ' + err.message });
  }
});

// PUT /api/organizations/:id
router.put('/organizations/:id', authorize('manageUsers'), async (req, res) => {
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', req.params.id);
  if (!org) return res.status(404).json({ error: 'Not found' });
  if (req.params.id === 'default') return res.status(400).json({ error: 'Cannot modify default organization' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    await db.run('UPDATE organizations SET name = ? WHERE id = ?', name, req.params.id);
    await addLog(`Organization updated: ${name}`, 'info');
    res.json({ ...org, name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

// DELETE /api/organizations/:id
router.delete('/organizations/:id', authorize('manageUsers'), async (req, res) => {
  if (req.params.id === 'default') return res.status(400).json({ error: 'Cannot delete default organization' });

  const org = await db.get('SELECT * FROM organizations WHERE id = ?', req.params.id);
  if (!org) return res.status(404).json({ error: 'Not found' });

  // Move users to default before deleting
  await db.run("UPDATE users SET orgId = 'default' WHERE orgId = ?", req.params.id);

  try {
    await db.run('DELETE FROM organizations WHERE id = ?', req.params.id);
    await addLog(`Organization deleted: ${org.name}`, 'warning');
    res.json({ message: 'Deleted, users moved to default organization' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

module.exports = router;
