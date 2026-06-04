const hostService = require('../host');

class HostStrategy {
  async backup(job) {
    return await hostService.backup({
      name: job.name,
      sourcePath: job.config?.sourcePath || job.source,
      backupPath: job.destination,
      excludes: job.config?.excludes || [],
    });
  }

  async restore(job, config, restoreFile, targetType) {
    return await hostService.restore({
      file: restoreFile,
      targetPath: targetType === 'original' ? (job.config?.sourcePath || job.source || '/') : (config?.targetPath || job.source || '/'),
    });
  }
}

module.exports = new HostStrategy();
