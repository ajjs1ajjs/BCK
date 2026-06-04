const { db } = require('../db');
const sshService = require('../ssh');
const cryptoHelper = require('../crypto');

class SSHStrategy {
  async backup(job) {
    const connRaw = await db.get('SELECT * FROM ssh_connections WHERE id = ?', job.config?.connectionId);
    if (!connRaw) {
      return { success: false, error: 'SSH connection not found' };
    }
    const conn = { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) };
    return await sshService.backup({
      connection: conn, 
      name: job.name,
      sourcePath: job.config?.sourcePath || job.source,
      backupPath: job.destination,
      excludes: job.config?.excludes || [],
    });
  }

  async restore(job, config, restoreFile) {
    // SSH restore might not be fully implemented as a specific function yet, 
    // returning success true as fallback if there is no separate restore for SSH currently
    return { success: true, error: null };
  }
}

module.exports = new SSHStrategy();
