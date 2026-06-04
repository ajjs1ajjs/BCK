const { db } = require('./db');
const logger = require('./logger');
const { getSettings, pruneLogs } = require('./helpers');

class CronManager {
  constructor() {
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    
    // Run cleanup tasks once a day (24 hours = 86400000 ms)
    this.timer = setInterval(() => {
      this.runCleanup();
    }, 86400000);
    
    logger.info('Daily cleanup cron started.');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runCleanup() {
    logger.info('Running daily cleanup tasks...');

    // 1. Prune System Logs
    try {
      await pruneLogs();
    } catch (e) {
      logger.error('Error during log pruning: ' + e.message);
    }

    // 2. Prune Webhook Deliveries (older than 7 days)
    try {
      const threshold7d = new Date();
      threshold7d.setDate(threshold7d.getDate() - 7);
      const res = await db.run('DELETE FROM webhook_deliveries WHERE deliveredAt < ?', threshold7d.toISOString());
      if (res.changes > 0) {
        logger.info(`Pruned ${res.changes} old webhook deliveries.`);
      }
    } catch (e) {
      logger.error('Error pruning webhook deliveries: ' + e.message);
    }

    // 3. Prune Backup History (older than 90 days)
    try {
      const threshold90d = new Date();
      threshold90d.setDate(threshold90d.getDate() - 90);
      const res = await db.run(
        "DELETE FROM backups WHERE (status = 'completed' OR status = 'failed') AND createdAt < ?", 
        threshold90d.toISOString()
      );
      if (res.changes > 0) {
        logger.info(`Pruned ${res.changes} old backup records from history.`);
      }
    } catch (e) {
      logger.error('Error pruning backup history: ' + e.message);
    }
  }
}

module.exports = new CronManager();
