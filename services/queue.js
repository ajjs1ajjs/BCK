const { db } = require('./db');
const logger = require('./logger');
// backupExecutor is loaded lazily in runJob() to avoid circular dependency

class DBTaskQueue {
  constructor(concurrency = 2, maxRetries = 3) {
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;
    this.running = 0;
    this.timer = null;
    this.isProcessing = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.processQueue(), 5000);
    logger.info('DB-backed TaskQueue started.');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Instead of passing arbitrary function, we just record the intent in DB.
  // Actually, for backups, the record is already created in the 'backups' table with status 'pending' by the API route.
  // The executeBackup logic can be called directly by processQueue.
  // We just need a way to 'push' immediately to wake up the queue.
  async push(jobId) {
    logger.info(`Job ${jobId} pushed to queue.`);
    if (global.io) {
      global.io.emit('jobQueued', { id: jobId });
      global.io.emit('queueStats', await this.getStats());
    }
    this.processQueue(); // trigger immediately
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.running < this.concurrency) {
        // Find next pending backup
        // Note: Using a transaction/lock is best for multi-worker, but for single instance this is fine.
        const pendingJob = await db.get(`
          SELECT * FROM backups 
          WHERE status = 'pending' 
          ORDER BY "createdAt" ASC 
          LIMIT 1
        `);

        if (!pendingJob) break; // no more jobs

        this.running++;
        
        // Let it run in background
        this.runJob(pendingJob).catch(err => {
          logger.error(`Unhandled error in job ${pendingJob.id}: ${err.message}`);
        }).finally(async () => {
          this.running--;
          if (global.io) global.io.emit('queueStats', await this.getStats());
          this.processQueue(); // trigger next
        });
      }
    } catch (e) {
      logger.error('Error in processQueue: ' + e.message);
    } finally {
      this.isProcessing = false;
    }
  }

  async runJob(job) {
    const backupExecutor = require('./backupExecutor');
    try {
      await backupExecutor.executeBackupInternal(job.id);
    } catch (e) {
      // executor already sets it to failed
    }
  }

  async getStats() {
    let pendingCount = 0;
    try {
      const row = await db.get("SELECT COUNT(*) as cnt FROM backups WHERE status = 'pending'");
      pendingCount = row?.cnt || 0;
    } catch (e) {}
    return {
      running: this.running,
      pending: pendingCount,
      concurrency: this.concurrency
    };
  }
}

const backupQueue = new DBTaskQueue(
  parseInt(process.env.MAX_CONCURRENT_BACKUPS) || 2,
  parseInt(process.env.MAX_BACKUP_RETRIES) || 3
);

module.exports = backupQueue;
