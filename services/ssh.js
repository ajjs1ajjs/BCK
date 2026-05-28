const path = require('path');
const fs = require('fs');
const { runAsync, checkTool } = require('./exec');

function buildSshArgs(conn, cmd) {
  const args = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15'];
  if (conn.port) args.push('-p', String(conn.port));
  if (conn.key) args.push('-i', conn.key);
  const userHost = conn.user ? `${conn.user}@${conn.host}` : conn.host;
  if (conn.password) {
    return { useSshpass: true, args: [...args, userHost, cmd] };
  }
  return { useSshpass: false, args: [...args, userHost, cmd] };
}

function wrapSshpass(conn, cmd, args) {
  if (conn.password) {
    return { cmd: 'sshpass', args: ['-p', conn.password, 'ssh', ...args] };
  }
  return { cmd: 'ssh', args };
}

async function exec(conn, command) {
  const { args, useSshpass } = buildSshArgs(conn, command);
  if (useSshpass) {
    const tool = checkTool('sshpass', 'sshpass -V');
    if (!tool.available) {
      return { success: false, error: 'sshpass not available for password-based auth. Install: apt install sshpass' };
    }
    return await runAsync('sshpass', ['-p', conn.password, 'ssh', ...args], { timeout: conn.timeout || 3600000 });
  }
  return await runAsync('ssh', args, { timeout: conn.timeout || 3600000 });
}

async function backup(backupConfig) {
  const { connection, sourcePath, backupPath, name, excludes } = backupConfig;
  const safeName = String(name || 'ssh-backup').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outFile = path.resolve(path.join(backupPath || '.', `${safeName}_${Date.now()}.tar.gz`));

  const excludesArgs = (excludes || []).concat(['/dev','/proc','/sys','/tmp']).map(e => `--exclude=${e}`).join(' ');
  const remoteCmd = `tar -czf - ${excludesArgs} -C ${sourcePath || '/'} . 2>/dev/null`;

  const { args, useSshpass } = buildSshArgs(connection, remoteCmd);
  let proc;
  const spawn = require('child_process').spawn;

  try {
    const outStream = fs.createWriteStream(outFile);
    let stderr = '';

    if (useSshpass) {
      proc = spawn('sshpass', ['-p', connection.password, 'ssh', ...args]);
    } else {
      proc = spawn('ssh', args);
    }

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

  const remoteCmd = `tar -xzf - -C ${target} 2>/dev/null`;
  const { args, useSshpass } = buildSshArgs(connection, remoteCmd);
  const spawn = require('child_process').spawn;
  let proc;

  try {
    if (useSshpass) {
      const tool = checkTool('sshpass', 'sshpass -V');
      if (!tool.available) {
        return { success: false, error: 'sshpass not available for password auth' };
      }
      proc = spawn('sshpass', ['-p', connection.password, 'ssh', ...args]);
    } else {
      proc = spawn('ssh', args);
    }

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

async function remoteDbBackup(dbConfig) {
  const { connection, type, database, user, password, host, port, backupPath, name } = dbConfig;
  const conn = connection || {};
  const safeName = String(name || 'db-backup').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const dbType = type || 'mysql';
  const dbHost = host || 'localhost';
  const dbPort = port || (dbType === 'mysql' ? 3306 : 5432);
  const dbUser = user || 'root';
  const dbName = database || '';

  let dumpCmd;
  if (dbType === 'mysql') {
    dumpCmd = `MYSQL_PWD='${password}' mysqldump -h ${dbHost} -P ${dbPort} -u ${dbUser} ${dbName} 2>/dev/null`;
  } else if (dbType === 'postgres') {
    dumpCmd = `PGPASSWORD='${password}' pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F c 2>/dev/null`;
  } else {
    return { success: false, error: `Unsupported DB type: ${dbType}` };
  }

  const ext = dbType === 'postgres' ? 'dump' : 'sql';
  const outFile = path.resolve(path.join(backupPath || '.', `${safeName}_${Date.now()}.${ext}`));
  const fullCmd = `${dumpCmd} > ${outFile}`;
  const result = await exec(conn, fullCmd);

  if (result.success) {
    let size = 0;
    try { size = fs.statSync(outFile).size; } catch {}
    return { success: size > 0, file: outFile, size, error: size > 0 ? null : 'Empty dump' };
  }
  return { success: false, error: result.stderr || result.error };
}

async function remoteDbRestore(restoreConfig) {
  const { connection, type, file, database, user, password, host, port } = restoreConfig;
  const conn = connection || {};
  const dbType = type || 'mysql';
  const dbHost = host || 'localhost';
  const dbPort = port || (dbType === 'mysql' ? 3306 : 5432);
  const dbUser = user || 'root';
  const dbName = database || '';

  if (!fs.existsSync(file)) {
    return { success: false, error: 'Dump file not found locally' };
  }

  const localFile = path.resolve(file);
  let restoreCmd;
  if (dbType === 'mysql') {
    restoreCmd = `MYSQL_PWD='${password}' mysql -h ${dbHost} -P ${dbPort} -u ${dbUser} ${dbName} < ${localFile} 2>/dev/null`;
  } else if (dbType === 'postgres') {
    restoreCmd = `PGPASSWORD='${password}' pg_restore -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c ${localFile} 2>/dev/null`;
  } else {
    return { success: false, error: `Unsupported DB type: ${dbType}` };
  }

  const result = await exec(conn, restoreCmd);
  return { success: result.success, error: result.stderr || result.error };
}

function checkTools() {
  const ssh = checkTool('ssh', 'ssh -V');
  const sshpass = checkTool('sshpass', 'sshpass -V');
  return {
    ssh: { available: ssh.available, version: ssh.version },
    sshpass: { available: sshpass.available, version: sshpass.version },
  };
}

module.exports = { backup, restore, remoteDbBackup, remoteDbRestore, exec, checkTools };
