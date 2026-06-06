const { db } = require('./db');
const logger = require('./logger');
const { pruneLogs } = require('./helpers');
const { runGfsRetention } = require('./gfsRetention');

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

    // 3. GFS Retention for Completed Backups
    await runGfsRetention();

    // 4. Prune Backup History (only failed backups older than 30 days, 
    // since completed backups are handled by GFS)
    try {
      const threshold30d = new Date();
      threshold30d.setDate(threshold30d.getDate() - 30);
      const res = await db.run(
        "DELETE FROM backups WHERE status = 'failed' AND \"createdAt\" < $1", 
        [threshold30d.toISOString()]
      );
      if (res.changes > 0) {
        logger.info(`Pruned ${res.changes} old failed backup records from history.`);
      }
    } catch (e) {
      logger.error('Error pruning failed backup history: ' + e.message);
    }
  }
}

module.exports = new CronManager();
