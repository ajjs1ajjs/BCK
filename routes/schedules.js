const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');

const { db } = require('../services/db');
const logger = require('../services/logger');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { addLog } = require('../services/helpers');
const { executeBackup } = require('./backups');

const cronTasks = {};

function refreshScheduler() {
  for (const id of Object.keys(cronTasks)) {
    cronTasks[id].stop();
    delete cronTasks[id];
  }

  const schedules = db.prepare('SELECT * FROM schedules WHERE enabled = 1').all();
  for (const s of schedules) {
    if (!s.cronExpression) continue;
    if (!cron.validate(s.cronExpression)) {
      console.warn(`Invalid cron expression for schedule "${s.name}": ${s.cronExpression}`);
      continue;
    }
    const task = cron.schedule(s.cronExpression, async () => {
      logger.info(`Triggering scheduled backup: ${s.name} (Job: ${s.backupId})`);
      db.prepare('UPDATE schedules SET lastRunAt = ? WHERE id = ?').run(new Date().toISOString(), s.id);
      executeBackup(s.backupId).catch(() => {});
    });
    cronTasks[s.id] = task;
  }
}

// GET /api/schedules
router.get('/schedules', async (req, res) => {
  const items = db.prepare('SELECT * FROM schedules').all();
  res.json(items);
});

// POST /api/schedules
router.post('/schedules', authorize('manageSchedules'), async (req, res) => {
  const v = validate('createSchedule', req.body);
  if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });
  const { name, cronExpression, backupId } = v.data;
  
  const schedule = { id: uuidv4(), name, cronExpression, backupId, enabled: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  
  try {
    db.prepare('INSERT INTO schedules (id, name, cronExpression, backupId, enabled, createdAt, updatedAt) VALUES (@id, @name, @cronExpression, @backupId, @enabled, @createdAt, @updatedAt)')
      .run(schedule);
    refreshScheduler();
    await addLog(`Schedule created: ${name}`, 'success');
    res.status(201).json(schedule);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save: ' + err.message });
  }
});

// PUT /api/schedules/:id
router.put('/schedules/:id', authorize('manageSchedules'), async (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  
  const update = { ...s, ...req.body, updatedAt: new Date().toISOString() };
  update.enabled = update.enabled ? 1 : 0;
  
  try {
    db.prepare('UPDATE schedules SET name = @name, cronExpression = @cronExpression, backupId = @backupId, enabled = @enabled, updatedAt = @updatedAt WHERE id = @id')
      .run(update);
    refreshScheduler();
    res.json(update);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update: ' + err.message });
  }
});

// DELETE /api/schedules/:id
router.delete('/schedules/:id', authorize('manageSchedules'), async (req, res) => {
  try {
    db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
    refreshScheduler();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

// Run daily log pruning task at midnight (00:00)
cron.schedule('0 0 * * *', () => {
  try {
    const { pruneLogs } = require('../services/helpers');
    pruneLogs();
  } catch (err) {
    logger.error('Failed to run scheduled log pruning: ' + err.message);
  }
});

module.exports = router;
module.exports.refreshScheduler = refreshScheduler;
