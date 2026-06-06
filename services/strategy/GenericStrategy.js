class GenericStrategy {
  async backup(job) {
    return { success: true, file: job.destination, error: null };
  }

  async restore(_job, _config, _restoreFile, _targetType) {
    return { success: true, error: null };
  }
}

module.exports = new GenericStrategy();
