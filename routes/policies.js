const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../services/db');
const { authorize } = require('../middleware/auth');
const { z } = require('zod');
const { validate } = require('../middleware/validation');

const policySchema = z.object({
  name: z.string().min(1, "Name is required"),
  keepDaily: z.number().int().min(0).default(7),
  keepWeekly: z.number().int().min(0).default(4),
  keepMonthly: z.number().int().min(0).default(12),
  keepYearly: z.number().int().min(0).default(1),
});

// GET /api/policies
router.get('/policies', authorize('read'), async (req, res) => {
  try {
    const policies = await db.all('SELECT * FROM policies ORDER BY "createdAt" DESC');
    res.json(policies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/policies
router.post('/policies', authorize('manageSettings'), validate(policySchema), async (req, res) => {
  const { name, keepDaily, keepWeekly, keepMonthly, keepYearly } = req.body;
  const id = uuidv4();
  const createdAt = new Date().toISOString();

  try {
    await db.run(
      'INSERT INTO policies (id, name, "keepDaily", "keepWeekly", "keepMonthly", "keepYearly", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, name, keepDaily, keepWeekly, keepMonthly, keepYearly, createdAt]
    );
    res.json({ id, name, keepDaily, keepWeekly, keepMonthly, keepYearly, createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/policies/:id
router.put('/policies/:id', authorize('manageSettings'), validate(policySchema), async (req, res) => {
  if (req.params.id === 'default') {
    return res.status(403).json({ error: "Cannot modify the default policy" });
  }

  const { name, keepDaily, keepWeekly, keepMonthly, keepYearly } = req.body;

  try {
    const result = await db.run(
      'UPDATE policies SET name = $1, "keepDaily" = $2, "keepWeekly" = $3, "keepMonthly" = $4, "keepYearly" = $5 WHERE id = $6',
      [name, keepDaily, keepWeekly, keepMonthly, keepYearly, req.params.id]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Policy not found' });
    res.json({ id: req.params.id, name, keepDaily, keepWeekly, keepMonthly, keepYearly });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/policies/:id
router.delete('/policies/:id', authorize('manageSettings'), async (req, res) => {
  if (req.params.id === 'default') {
    return res.status(403).json({ error: "Cannot delete the default policy" });
  }

  try {
    // Check if in use
    const inUse = await db.get('SELECT COUNT(*) as count FROM backups WHERE "policyId" = $1', [req.params.id]);
    if (inUse && inUse.count > 0) {
      return res.status(400).json({ error: "Cannot delete policy currently in use by backups" });
    }

    const result = await db.run('DELETE FROM policies WHERE id = $1', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Policy not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
