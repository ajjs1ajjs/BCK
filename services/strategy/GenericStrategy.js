class GenericStrategy {
  async backup(job) {
    return { success: true, file: job.destination, error: null };
  }

  async restore(job, config, restoreFile, targetType) {
    return { success: true, error: null };
  }
}

module.exports = new GenericStrategy();
