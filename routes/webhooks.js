const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { db } = require('../services/db');
const { authenticate, authorize } = require('../middleware/auth');
const { addLog } = require('../services/helpers');
const { testEndpoint, EVENT_TYPES } = require('../services/webhooks');

// GET /api/webhooks/events — list all supported event types
router.get('/webhooks/events', async (req, res) => {
  res.json(EVENT_TYPES);
});

// GET /api/webhooks — list all endpoints
router.get('/webhooks', authorize('configure'), async (req, res) => {
  const endpoints = db.prepare('SELECT * FROM webhook_endpoints ORDER BY createdAt DESC').all();
  res.json(endpoints.map(e => ({ ...e, events: JSON.parse(e.events || '[]') })));
});

// GET /api/webhooks/:id/deliveries — delivery history for an endpoint
router.get('/webhooks/:id/deliveries', authorize('configure'), async (req, res) => {
  const deliveries = db.prepare(
    'SELECT * FROM webhook_deliveries WHERE endpointId = ? ORDER BY deliveredAt DESC LIMIT 100'
  ).all(req.params.id);
  res.json(deliveries);
});

// POST /api/webhooks — create endpoint
router.post('/webhooks', authorize('configure'), async (req, res) => {
  const { name, url, secret, events, retries } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const endpoint = {
    id: uuidv4(),
    name,
    url,
    secret: secret || null,
    events: JSON.stringify(Array.isArray(events) ? events : []),
    retries: Math.min(parseInt(retries) || 3, 10),
    active: 1,
    orgId: req.user.orgId || 'default',
    createdAt: new Date().toISOString(),
  };

  try {
    db.prepare(`
      INSERT INTO webhook_endpoints (id, name, url, secret, events, retries, active, orgId, createdAt)
      VALUES (@id, @name, @url, @secret, @events, @retries, @active, @orgId, @createdAt)
    `).run(endpoint);
    await addLog(`Webhook endpoint added: ${name} → ${url}`, 'info');
    res.status(201).json({ ...endpoint, events: JSON.parse(endpoint.events) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create: ' + err.message });
  }
});

// PUT /api/webhooks/:id — update endpoint
router.put('/webhooks/:id', authorize('configure'), async (req, res) => {
  const ep = db.prepare('SELECT * FROM webhook_endpoints WHERE id = ?').get(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Not found' });

  const { name, url, secret, events, retries, active } = req.body;
  const updated = {
    ...ep,
    name: name ?? ep.name,
    url: url ?? ep.url,
    secret: secret !== undefined ? (secret || null) : ep.secret,
    events: JSON.stringify(Array.isArray(events) ? events : JSON.parse(ep.events)),
    retries: retries !== undefined ? Math.min(parseInt(retries) || 3, 10) : ep.retries,
    active: active !== undefined ? (active ? 1 : 0) : ep.active,
  };

  try {
    db.prepare(`
      UPDATE webhook_endpoints SET name=@name, url=@url, secret=@secret, events=@events,
      retries=@retries, active=@active WHERE id=@id
    `).run(updated);
    await addLog(`Webhook endpoint updated: ${updated.name}`, 'info');
    res.json({ ...updated, events: JSON.parse(updated.events) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

// DELETE /api/webhooks/:id — delete endpoint
router.delete('/webhooks/:id', authorize('configure'), async (req, res) => {
  const ep = db.prepare('SELECT * FROM webhook_endpoints WHERE id = ?').get(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM webhook_endpoints WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM webhook_deliveries WHERE endpointId = ?').run(req.params.id);
  await addLog(`Webhook endpoint deleted: ${ep.name}`, 'warning');
  res.json({ message: 'Deleted' });
});

// POST /api/webhooks/:id/test — send a test ping
router.post('/webhooks/:id/test', authorize('configure'), async (req, res) => {
  const ep = db.prepare('SELECT * FROM webhook_endpoints WHERE id = ?').get(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Not found' });

  const result = await testEndpoint(ep);
  res.json({ success: result.success, statusCode: result.statusCode, error: result.error || null });
});

module.exports = router;
