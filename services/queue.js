const logger = require('./logger');

class TaskQueue {
  constructor(concurrency = 2) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  /**
   * Adds a task to the queue.
   * @param {string} id Unique identifier for the task (e.g., backup ID)
   * @param {Function} task Async function to execute
   * @param {Object} metadata Additional info for logging
   */
  push(id, task, metadata = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id, task, metadata, resolve, reject });
      this.next();
    });
  }

  async next() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const { id, task, metadata, resolve, reject } = this.queue.shift();
    this.running++;

    logger.info(`Starting task ${id} (${metadata.name || 'unknown'}). Queue size: ${this.queue.length}`);

    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      logger.error(`Task ${id} failed: ${err.message}`);
      reject(err);
    } finally {
      this.running--;
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
const backupQueue = new TaskQueue(parseInt(process.env.MAX_CONCURRENT_BACKUPS) || 2);

module.exports = backupQueue;
