const vmService = require('../vm');

class VMStrategy {
  async backup(job) {
    return await vmService.backup({
      type: job.backupType || job.type, 
      vmName: job.config?.vmName || job.name,
      host: job.config?.host, 
      user: job.config?.user, 
      password: job.config?.password,
      datastore: job.config?.datastore, 
      backupPath: job.destination,
    });
  }

  async restore(job, config, restoreFile) {
    return await vmService.restore({
      type: job.backupType || job.type, 
      vmName: config?.vmName || job.name + '-restored',
      host: config?.host, 
      user: config?.user, 
      password: config?.password,
      file: restoreFile,
    });
  }
}

module.exports = new VMStrategy();
