const logger = require('./logger');

class TaskQueue {
  constructor(concurrency = 2, maxRetries = 3) {
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;
    this.running = 0;
    this.queue = [];
  }

  /**
   * Adds a task to the queue.
   * @param {string} id Unique identifier for the task
   * @param {Function} task Async function to execute
   * @param {Object} metadata Additional info
   * @param {number} retry Attempt number (starts at 0)
   */
  push(id, task, metadata = {}, retry = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id, task, metadata, retry, resolve, reject });
      this.next();
    });
  }

  async next() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    const { id, task, metadata, retry, resolve, reject } = item;
    this.running++;

    const attemptLabel = retry > 0 ? ` (Attempt ${retry + 1})` : '';
    logger.info(`Starting task ${id}${attemptLabel}. Queue size: ${this.queue.length}`);

    if (global.io) {
      global.io.emit('taskStarted', { id, name: metadata.name, retry });
      global.io.emit('queueStats', this.getStats());
    }

    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      if (retry < this.maxRetries) {
        logger.warn(`Task ${id} failed, retrying in 30s... (${retry + 1}/${this.maxRetries})`);
        setTimeout(() => {
          this.push(id, task, metadata, retry + 1)
            .then(resolve)
            .catch(reject);
        }, 30000);
      } else {
        logger.error(`Task ${id} failed after ${this.maxRetries} retries: ${err.message}`);
        reject(err);
      }
    } finally {
      this.running--;
      if (global.io) {
        global.io.emit('queueStats', this.getStats());
      }
      this.next();
    }
  }

  getStats() {
    return {
      running: this.running,
      pending: this.queue.length,
      concurrency: this.concurrency
    };
  }
}

// Create a singleton instance
const backupQueue = new TaskQueue(
  parseInt(process.env.MAX_CONCURRENT_BACKUPS) || 2,
  parseInt(process.env.MAX_BACKUP_RETRIES) || 3
);

module.exports = backupQueue;
