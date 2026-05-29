const path = require('path');
const fs = require('fs');
const { runAsync, checkTool } = require('./exec');

/**
 * Escapes a string for use in a shell command.
 */
function shellEscape(arg) {
  if (typeof arg !== 'string') arg = String(arg);
  if (/^[a-z0-9/_.-]+$/i.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function buildSshArgs(conn, remoteCmd) {
  const args = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15',
    '-o', 'BatchMode=yes'
  ];
  if (conn.port) args.push('-p', String(conn.port));
  if (conn.key) args.push('-i', conn.key);
  
  const userHost = conn.user ? `${conn.user}@${conn.host}` : conn.host;
  
  const finalArgs = [...args, userHost, remoteCmd];
  
  if (conn.password) {
    return { cmd: 'sshpass', args: ['-p', conn.password, 'ssh', ...finalArgs] };
  }
  return { cmd: 'ssh', args: finalArgs };
}

async function exec(conn, command) {
  const { cmd, args } = buildSshArgs(conn, command);
  if (cmd === 'sshpass') {
    const tool = checkTool('sshpass', 'sshpass', ['-V']);
    if (!tool.available) {
      return { success: false, error: 'sshpass not available for password-based auth. Install: apt install sshpass' };
    }
  }
  return await runAsync(cmd, args, { timeout: conn.timeout || 3600000 });
}

async function backup(backupConfig) {
  const { connection, sourcePath, backupPath, name, excludes } = backupConfig;
  const safeName = String(name || 'ssh-backup').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outFile = path.resolve(path.join(backupPath || '.', `${safeName}_${Date.now()}.tar.gz`));

  const excludesArgs = (excludes || [])
    .concat(['/dev', '/proc', '/sys', '/tmp', '/run', '/mnt', '/media', '/lost+found'])
    .map(e => `--exclude=${shellEscape(e)}`)
    .join(' ');
    
  const remoteCmd = `tar -czf - ${excludesArgs} -C ${shellEscape(sourcePath || '/')} .`;

  const { cmd, args } = buildSshArgs(connection, remoteCmd);
  const spawn = require('child_process').spawn;

  try {
    const outStream = fs.createWriteStream(outFile);
    let stderr = '';

    const proc = spawn(cmd, args);

    proc.stdout.pipe(outStream);
    proc.stderr.on('data', d => { stderr += d.toString(); });

    return new Promise((resolve) => {
      proc.on('close', (code) => {
        outStream.close();
        let size = 0;
        try { size = fs.statSync(outFile).size; } catch {}
        const success = code === 0 && size > 0;
        resolve({
          success,
          file: outFile,
          size,
          error: success ? null : (stderr.trim() || `ssh exit code ${code}`),
        });
      });
      proc.on('error', (err) => {
        outStream.close();
        resolve({ success: false, error: err.message });
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function restore(restoreConfig) {
  const { connection, file, targetPath } = restoreConfig;
  const archive = path.resolve(file || '');
  const target = targetPath || '/';

  if (!fs.existsSync(archive)) {
    return { success: false, error: 'Backup file not found' };
  }

  const remoteCmd = `tar -xzf - -C ${shellEscape(target)}`;
  const { cmd, args } = buildSshArgs(connection, remoteCmd);
  const spawn = require('child_process').spawn;

  try {
    const proc = spawn(cmd, args);
    const inStream = fs.createReadStream(archive);
    inStream.pipe(proc.stdin);
    
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    return new Promise((resolve) => {
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          error: code === 0 ? null : (stderr.trim() || `ssh exit code ${code}`),
        });
      });
      proc.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function checkTools() {
  const ssh = checkTool('ssh', 'ssh', ['-V']);
  const sshpass = checkTool('sshpass', 'sshpass', ['-V']);
  return {
    ssh: { available: ssh.available, version: ssh.version },
    sshpass: { available: sshpass.available, version: sshpass.version },
  };
}

module.exports = { backup, restore, exec, checkTools };
