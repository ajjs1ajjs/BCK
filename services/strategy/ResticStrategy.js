const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fsSync = require('fs');
const path = require('path');
const logger = require('../logger');

class ResticStrategy {
  async _initRepo(repoPath, password) {
    if (fsSync.existsSync(path.join(repoPath, 'config'))) {
      return; // Already initialized
    }
    logger.info(`Initializing Restic repository at ${repoPath}`);
    await exec(`restic init -r "${repoPath}"`, {
      env: { ...process.env, RESTIC_PASSWORD: password }
    });
  }

  async backup(job) {
    try {
      const source = job.config?.sourcePath || job.source;
      const destination = job.destination;
      const password = job.config?.encryptionPassword || 'default_restic_pass_if_not_set';

      if (!fsSync.existsSync(destination)) {
        fsSync.mkdirSync(destination, { recursive: true });
      }

      await this._initRepo(destination, password);

      logger.info(`Starting restic backup for ${source} to ${destination}`);
      
      let excludes = '';
      if (job.config?.excludes && Array.isArray(job.config.excludes)) {
        excludes = job.config.excludes.map(e => `--exclude "${e}"`).join(' ');
      }

      const { stdout } = await exec(`restic -r "${destination}" backup "${source}" ${excludes}`, {
        env: { ...process.env, RESTIC_PASSWORD: password }
      });
      
      logger.info(`Restic backup success: ${stdout}`);
      
      return { success: true, file: destination, error: null };
    } catch (err) {
      logger.error(`Restic backup failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async restore(job, config, restoreFile, targetType) {
    try {
      const destination = job.destination;
      const password = job.config?.encryptionPassword || 'default_restic_pass_if_not_set';
      const targetPath = targetType === 'original' ? (job.config?.sourcePath || job.source || '/') : (config?.targetPath || job.source || '/');

      logger.info(`Starting restic restore from ${destination} to ${targetPath}`);

      if (!fsSync.existsSync(targetPath)) {
        fsSync.mkdirSync(targetPath, { recursive: true });
      }

      const snapshotId = config?.snapshotId || 'latest';

      const { stdout } = await exec(`restic -r "${destination}" restore ${snapshotId} --target "${targetPath}"`, {
        env: { ...process.env, RESTIC_PASSWORD: password }
      });
      
      logger.info(`Restic restore success: ${stdout}`);
      
      return { success: true, error: null };
    } catch (err) {
      logger.error(`Restic restore failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new ResticStrategy();
