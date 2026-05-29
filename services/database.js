const { run, runAsync, checkTool } = require('./exec');
const spawn = require('child_process').spawn;
const fs = require('fs');
const zlib = require('zlib');
const os = require('os');
const path = require('path');

const ENGINES = {
  mysql: {
    dump: (conn) => ({
      cmd: 'mysqldump',
      args: ['-h', conn.host, '-P', String(conn.port || 3306), '-u', conn.user, conn.database],
      env: conn.password ? { ...process.env, MYSQL_PWD: conn.password } : process.env,
    }),
    restore: (conn) => ({
      cmd: 'mysql',
      args: ['-h', conn.host, '-P', String(conn.port || 3306), '-u', conn.user, conn.database],
      env: conn.password ? { ...process.env, MYSQL_PWD: conn.password } : process.env,
    }),
    check: () => checkTool('mysqldump', 'mysqldump', ['--version']),
    list: async (conn) => {
      const env = conn.password ? { ...process.env, MYSQL_PWD: conn.password } : process.env;
      const r = await runAsync('mysql', ['-h', conn.host, '-P', String(conn.port || 3306), '-u', conn.user, '-e', 'SHOW DATABASES', '--batch', '--skip-column-names'], { env });
      if (!r.success) return [];
      return r.stdout.split('\n').map(d => d.trim()).filter(d => d && !['information_schema','performance_schema','mysql','sys'].includes(d));
    },
  },
  postgres: {
    dump: (conn) => ({
      cmd: 'pg_dump',
      args: ['-h', conn.host, '-p', String(conn.port || 5432), '-U', conn.user, '-d', conn.database, '-F', 'c'],
      env: conn.password ? { ...process.env, PGPASSWORD: conn.password } : process.env,
    }),
    restore: (conn) => ({
      cmd: 'pg_restore',
      args: ['-h', conn.host, '-p', String(conn.port || 5432), '-U', conn.user, '-d', conn.database, '-c'],
      env: conn.password ? { ...process.env, PGPASSWORD: conn.password } : process.env,
    }),
    check: () => checkTool('pg_dump', 'pg_dump', ['--version']),
    list: async (conn) => {
      const env = conn.password ? { ...process.env, PGPASSWORD: conn.password } : process.env;
      const r = await runAsync('psql', ['-h', conn.host, '-p', String(conn.port || 5432), '-U', conn.user, '-l', '-t', '-A'], { env });
      if (!r.success) return [];
      return r.stdout.split('\n').map(l => l.split('|')[0].trim()).filter(Boolean);
    },
  },
  oracle: {
    dump: (conn, outFile) => ({
      cmd: 'expdp',
      args: [`${conn.user}@//${conn.host}:${conn.port || 1521}/${conn.service}`, 'directory=DATA_PUMP_DIR', `dumpfile=${outFile}`],
      env: conn.password ? { ...process.env, ORACLE_HOME: conn.oracleHome || '', ORACLE_PWD: conn.password } : { ...process.env, ORACLE_HOME: conn.oracleHome || '' },
    }),
    restore: (conn, inFile) => ({
      cmd: 'impdp',
      args: [`${conn.user}@//${conn.host}:${conn.port || 1521}/${conn.service}`, 'directory=DATA_PUMP_DIR', `dumpfile=${inFile}`],
      env: conn.password ? { ...process.env, ORACLE_HOME: conn.oracleHome || '', ORACLE_PWD: conn.password } : { ...process.env, ORACLE_HOME: conn.oracleHome || '' },
    }),
    check: () => checkTool('expdp', 'expdp', ['help=y']),
    list: async () => [],
  },
};

function getDiskSpace(dirPath) {
  const absolutePath = path.resolve(dirPath);
  try {
    if (os.platform() === 'win32') {
      const drive = absolutePath.substring(0, 1);
      const r = run('powershell', ['-NoProfile', '-Command', `Get-Volume -DriveLetter ${drive} | Select-Object SizeRemaining, Size`]);
      if (r.success) {
        const lines = r.stdout.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          const free = parseInt(parts[0], 10);
          const total = parseInt(parts[1], 10);
          return { free, total };
        }
      }
    } else {
      const r = run('df', ['-B1', absolutePath]);
      if (r.success) {
        const lines = r.stdout.split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          const total = parseInt(parts[1], 10);
          const free = parseInt(parts[3], 10);
          return { free, total };
        }
      }
    }
  } catch (err) {
    // ignore
  }
  return { free: 1024 * 1024 * 1024, total: 10 * 1024 * 1024 * 1024 }; // 1GB free fallback
}

function getEngine(type) {
  const engine = ENGINES[type];
  if (!engine) throw new Error(`Unsupported DB engine: ${type}`);
  return engine;
}

function runCommandWithRedirection({ cmd, args, env, outFile, inFile }) {
  return new Promise((resolve) => {
    let stderr = '';
    
    try {
      const spawnOpts = { env: env || process.env };
      if (inFile) {
        spawnOpts.stdio = ['pipe', 'pipe', 'pipe'];
      } else if (outFile) {
        spawnOpts.stdio = ['ignore', 'pipe', 'pipe'];
      }
      
      const p = spawn(cmd, args, spawnOpts);
      
      if (outFile) {
        const outStream = fs.createWriteStream(outFile);
        if (outFile.endsWith('.gz')) {
          const gzip = zlib.createGzip();
          p.stdout.pipe(gzip).pipe(outStream);
        } else {
          p.stdout.pipe(outStream);
        }
        outStream.on('error', (err) => {
          stderr += `\nWrite stream error: ${err.message}`;
        });
      }

      if (inFile) {
        const inStream = fs.createReadStream(inFile);
        if (inFile.endsWith('.gz')) {
          const gunzip = zlib.createGunzip();
          inStream.pipe(gunzip).pipe(p.stdin);
        } else {
          inStream.pipe(p.stdin);
        }
        inStream.on('error', (err) => {
          stderr += `\nRead stream error: ${err.message}`;
        });
      }

      if (p.stderr) {
        p.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      p.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      p.on('close', (code) => {
        resolve({
          success: code === 0,
          error: code === 0 ? null : (stderr.trim() || `Exit code ${code}`),
        });
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

async function backup(backupConfig) {
  const { type, connection, backupPath, name } = backupConfig;
  const engine = getEngine(type);

  const toolCheck = engine.check();
  if (!toolCheck.available) {
    return { success: false, error: `${type} CLI tools not found on server` };
  }

  // Disk space check
  const disk = getDiskSpace(backupPath);
  if (disk && disk.free < 50 * 1024 * 1024) { // Less than 50MB free
    return { success: false, error: `Insufficient disk space: only ${(disk.free / 1024 / 1024).toFixed(2)}MB free` };
  }

  const outFile = path.join(backupPath, `${name}_${Date.now()}.${type === 'postgres' ? 'dump' : (type === 'mysql' ? 'sql.gz' : 'sql')}`);
  const dumpConf = engine.dump(connection, outFile);

  let result;
  if (type === 'oracle') {
    const r = await runAsync(dumpConf.cmd, dumpConf.args, { env: dumpConf.env });
    result = { success: r.success, error: r.stderr };
  } else {
    result = await runCommandWithRedirection({
      cmd: dumpConf.cmd,
      args: dumpConf.args,
      env: dumpConf.env,
      outFile,
    });
  }

  let size = 0;
  if (result.success) {
    try {
      size = (await fs.promises.stat(outFile))?.size || 0;
    } catch {}
  }

  return {
    success: result.success,
    file: outFile,
    error: result.error,
    size,
  };
}

async function restore(restoreConfig) {
  const { type, connection, file } = restoreConfig;
  const engine = getEngine(type);

  const toolCheck = engine.check();
  if (!toolCheck.available) {
    return { success: false, error: `${type} CLI tools not found on server` };
  }

  const restoreConf = engine.restore(connection, file);

  let result;
  if (type === 'oracle') {
    const r = await runAsync(restoreConf.cmd, restoreConf.args, { env: restoreConf.env });
    result = { success: r.success, error: r.stderr };
  } else {
    result = await runCommandWithRedirection({
      cmd: restoreConf.cmd,
      args: restoreConf.args,
      env: restoreConf.env,
      inFile: file,
    });
  }

  return { success: result.success, error: result.error };
}

async function listDatabases(type, conn) {
  const engine = getEngine(type);
  return await engine.list(conn);
}

function checkTools(type) {
  const engine = getEngine(type);
  return engine.check();
}

module.exports = { backup, restore, listDatabases, checkTools, ENGINES };
