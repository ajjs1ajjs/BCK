const { runAsync, checkTool, getDiskStats } = require('./exec');
const spawn = require('child_process').spawn;
const fs = require('fs');
const zlib = require('zlib');

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
      if (!r.success) throw new Error(r.stderr || 'Connection failed');
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
      if (!r.success) throw new Error(r.stderr || 'Connection failed');
      return r.stdout.split('\n').map(l => l.split('|')[0].trim()).filter(Boolean);
    },
  },
  oracle: {
    /**
     * NOTE on Oracle Data Pump:
     * expdp/impdp create and read files relative to the Oracle server's DATA_PUMP_DIR.
     * This service assumes the backup system is running on the same host as Oracle 
     * or has access to its data pump directory via a shared mount.
     */
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
  mongodb: {
    dump: (conn) => {
      const args = ['--host', conn.host, '--port', String(conn.port || 27017)];
      if (conn.user) args.push('--username', conn.user);
      if (conn.password) args.push('--password', conn.password);
      if (conn.database) args.push('--db', conn.database);
      args.push('--archive'); // Output to stdout
      return { cmd: 'mongodump', args, env: process.env };
    },
    restore: (conn) => {
      const args = ['--host', conn.host, '--port', String(conn.port || 27017)];
      if (conn.user) args.push('--username', conn.user);
      if (conn.password) args.push('--password', conn.password);
      args.push('--archive'); // Read from stdin
      return { cmd: 'mongorestore', args, env: process.env };
    },
    check: async () => {
      const dump = await checkTool('mongodump', 'mongodump', ['--version']);
      const shell = await checkTool('mongosh', 'mongosh', ['--version']);
      const oldShell = !shell.available ? await checkTool('mongo', 'mongo', ['--version']) : { available: false };
      return { 
        available: dump.available && (shell.available || oldShell.available),
        details: `mongodump: ${dump.available ? 'OK' : 'MISSING'}, shell: ${shell.available ? 'mongosh' : oldShell.available ? 'mongo' : 'MISSING'}`
      };
    },
    list: async (conn) => {
      let shell = 'mongosh';
      const check = await checkTool('mongosh', 'mongosh', ['--version']);
      if (!check.available) shell = 'mongo';
      
      const args = ['--host', conn.host, '--port', String(conn.port || 27017), '--eval', 'db.adminCommand("listDatabases").databases.map(d => d.name).join("\\n")', '--quiet'];
      if (conn.user) args.push('--username', conn.user);
      if (conn.password) args.push('--password', conn.password);
      const r = await runAsync(shell, args);
      if (!r.success) throw new Error(r.stderr || 'Connection failed');
      return r.stdout.split('\n').map(d => d.trim()).filter(Boolean);
    },
  },
  mssql: {
    dump: (conn, outFile) => ({
      cmd: 'sqlcmd',
      args: ['-S', `${conn.host},${conn.port || 1433}`, '-U', conn.user, '-Q', `BACKUP DATABASE [${conn.database}] TO DISK='${outFile}' WITH FORMAT, INIT`],
      env: conn.password ? { ...process.env, SQLCMDPASSWORD: conn.password } : process.env,
    }),
    restore: (conn, file) => ({
      cmd: 'sqlcmd',
      args: ['-S', `${conn.host},${conn.port || 1433}`, '-U', conn.user, '-Q', `RESTORE DATABASE [${conn.database}] FROM DISK='${file}' WITH REPLACE`],
      env: conn.password ? { ...process.env, SQLCMDPASSWORD: conn.password } : process.env,
    }),
    check: () => checkTool('sqlcmd', 'sqlcmd', ['-?']),
    list: async (conn) => {
      const env = conn.password ? { ...process.env, SQLCMDPASSWORD: conn.password } : process.env;
      const r = await runAsync('sqlcmd', ['-S', `${conn.host},${conn.port || 1433}`, '-U', conn.user, '-h', '-1', '-W', '-Q', "SELECT name FROM sys.databases WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')"], { env });
      if (!r.success) throw new Error(r.stderr || 'Connection failed');
      return r.stdout.split('\n').map(d => d.trim()).filter(Boolean);
    },
  },
  redis: {
    dump: (conn, outFile) => {
      const args = ['-h', conn.host, '-p', String(conn.port || 6379)];
      if (conn.password) args.push('-a', conn.password);
      args.push('--rdb', outFile);
      return { cmd: 'redis-cli', args, env: process.env };
    },
    restore: () => {
      throw new Error('Redis restore must be performed manually by replacing the dump.rdb file in the Redis data directory and restarting the service.');
    },
    check: () => checkTool('redis-cli', 'redis-cli', ['--version']),
    list: async () => ['db0', 'db1', 'db2', 'db3', 'db4', 'db5', 'db6', 'db7', 'db8', 'db9', 'db10', 'db11', 'db12', 'db13', 'db14', 'db15'],
  },
};

function getEngine(type) {
  const engine = ENGINES[type];
  if (!engine) throw new Error(`Unsupported DB engine: ${type}`);
  return engine;
}

function runCommandWithRedirection({ cmd, args, env, outFile, inFile, timeout = 3600000 }) {
  return new Promise((resolve) => {
    let stderr = '';
    let timer;
    
    try {
      const spawnOpts = { env: env || process.env };
      if (inFile) {
        spawnOpts.stdio = ['pipe', 'pipe', 'pipe'];
      } else if (outFile) {
        spawnOpts.stdio = ['ignore', 'pipe', 'pipe'];
      }
      
      const p = spawn(cmd, args, spawnOpts);
      
      if (timeout) {
        timer = setTimeout(() => {
          p.kill('SIGTERM');
          resolve({ success: false, error: `Process timed out after ${timeout}ms` });
        }, timeout);
      }

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
        if (timer) clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });

      p.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({
          success: code === 0,
          error: code === 0 ? null : (stderr.trim() || `Exit code ${code}`),
        });
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
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
  const disk = getDiskStats(backupPath);
  if (disk && disk.free < 50 * 1024 * 1024) { // Less than 50MB free
    return { success: false, error: `Insufficient disk space: only ${(disk.free / 1024 / 1024).toFixed(2)}MB free` };
  }

  const extension = type === 'postgres' ? 'dump' : (type === 'mysql' ? 'sql.gz' : (type === 'mssql' ? 'bak' : (type === 'redis' ? 'rdb' : 'sql')));
  const outFile = path.join(backupPath, `${name}_${Date.now()}.${extension}`);
  const dumpConf = engine.dump(connection, outFile);

  let result;
  if (type === 'oracle' || type === 'mssql' || type === 'redis') {
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
  if (type === 'oracle' || type === 'mssql' || type === 'redis') {
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
