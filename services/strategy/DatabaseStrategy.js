const cryptoHelper = require('../crypto');
const { db } = require('../db');
const dbService = require('../database');

class DatabaseStrategy {
  async backup(job) {
    const connRaw = await db.get('SELECT * FROM db_connections WHERE id = ?', job.config?.connectionId);
    const conn = connRaw ? { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) } : job.config;
    return await dbService.backup({
      type: job.backupType || job.type, 
      connection: conn, 
      backupPath: job.destination, 
      name: job.name,
    });
  }

  async restore(job, config, restoreFile) {
    const connRaw = await db.get('SELECT * FROM db_connections WHERE id = ?', config?.connectionId);
    const conn = connRaw ? { ...connRaw, password: cryptoHelper.decrypt(connRaw.password) } : null;
    return await dbService.restore({
      type: job.backupType || job.type, 
      connection: conn || config, 
      file: restoreFile,
    });
  }
}

module.exports = new DatabaseStrategy();
