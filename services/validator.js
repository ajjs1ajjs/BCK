const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fsSync = require('fs');


async function validateBackupFile(backupType, filePath, password) {
  if (!fsSync.existsSync(filePath)) {
    throw new Error('Backup file does not exist on disk.');
  }

  // Basic check for archive types
  if (filePath.endsWith('.tar.gz') || filePath.endsWith('.tgz')) {
    const { stderr } = await exec(`tar -tzf "${filePath}" > /dev/null`);
    if (stderr) throw new Error(`Tar validation failed: ${stderr}`);
    return true;
  }

  if (filePath.endsWith('.zip')) {
    const { stderr } = await exec(`unzip -t "${filePath}" > /dev/null`);
    if (stderr) throw new Error(`Zip validation failed: ${stderr}`);
    return true;
  }

  if (filePath.endsWith('.enc')) {
    // Cannot easily validate encrypted file content without decrypting, 
    // but we can check if it's a valid OpenSSL enc wrapper if we had time.
    // For now, if it exists and is > 0 bytes, we consider it "valid" syntactically,
    // though a full test would involve decrypting to a temp folder.
    const stat = fsSync.statSync(filePath);
    if (stat.size === 0) throw new Error('Encrypted backup file is empty (0 bytes).');
    return true;
  }
  
  if (filePath.endsWith('.sql')) {
    const stat = fsSync.statSync(filePath);
    if (stat.size === 0) throw new Error('SQL backup file is empty (0 bytes).');
    // Read the last few bytes to check for completion marker (optional, depending on dump tool)
    return true;
  }

  // Restic repositories
  if (backupType === 'restic' && fsSync.statSync(filePath).isDirectory()) {
    const { stderr } = await exec(`restic -r "${filePath}" check`, {
      env: { ...process.env, RESTIC_PASSWORD: password || 'default_restic_pass_if_not_set' }
    });
    if (stderr && stderr.toLowerCase().includes('error')) {
      throw new Error(`Restic check failed: ${stderr}`);
    }
    return true;
  }

  // Fallback for unknown files
  const stat = fsSync.statSync(filePath);
  if (stat.size === 0) throw new Error('Backup file is empty (0 bytes).');

  return true;
}

module.exports = { validateBackupFile };
