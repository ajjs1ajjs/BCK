const { run, checkTool } = require('./exec');

const ENGINES = {
  mysql: {
    dump: (conn, outFile) =>
      `mysqldump -h ${conn.host} -P ${conn.port || 3306} -u ${conn.user} ${conn.password ? `-p${conn.password}` : ''} ${conn.database} > "${outFile}"`,
    restore: (conn, inFile) =>
      `mysql -h ${conn.host} -P ${conn.port || 3306} -u ${conn.user} ${conn.password ? `-p${conn.password}` : ''} ${conn.database} < "${inFile}"`,
    check: () => checkTool('mysqldump', 'mysqldump --version'),
    list: (conn) => {
      const r = run(`mysql -h ${conn.host} -P ${conn.port || 3306} -u ${conn.user} ${conn.password ? `-p${conn.password}` : ''} -e "SHOW DATABASES" --batch --skip-column-names 2>&1`);
      if (!r.success) return [];
      return r.stdout.split('\n').filter(d => !['information_schema','performance_schema','mysql','sys'].includes(d.trim()));
    },
  },
  postgres: {
    dump: (conn, outFile) => {
      const env = conn.password ? { ...process.env, PGPASSWORD: conn.password } : process.env;
      return { cmd: `pg_dump -h ${conn.host} -p ${conn.port || 5432} -U ${conn.user} -d ${conn.database} -F c > "${outFile}"`, env };
    },
    restore: (conn, inFile) => {
      const env = conn.password ? { ...process.env, PGPASSWORD: conn.password } : process.env;
      return { cmd: `pg_restore -h ${conn.host} -p ${conn.port || 5432} -U ${conn.user} -d ${conn.database} -c "${inFile}"`, env };
    },
    check: () => checkTool('pg_dump', 'pg_dump --version'),
    list: (conn) => {
      const env = conn.password ? { ...process.env, PGPASSWORD: conn.password } : process.env;
      const r = run(`psql -h ${conn.host} -p ${conn.port || 5432} -U ${conn.user} -l -t -A 2>&1`, { env });
      if (!r.success) return [];
      return r.stdout.split('\n').map(l => l.split('|')[0]).filter(Boolean);
    },
  },
  oracle: {
    dump: (conn, outFile) => {
      const env = { ...process.env, ORACLE_HOME: conn.oracleHome || '' };
      return { cmd: `expdp ${conn.user}/${conn.password}@//${conn.host}:${conn.port || 1521}/${conn.service} directory=DATA_PUMP_DIR dumpfile="${outFile}"`, env };
    },
    restore: (conn, inFile) => {
      const env = { ...process.env, ORACLE_HOME: conn.oracleHome || '' };
      return { cmd: `impdp ${conn.user}/${conn.password}@//${conn.host}:${conn.port || 1521}/${conn.service} directory=DATA_PUMP_DIR dumpfile="${inFile}"`, env };
    },
    check: () => checkTool('expdp', 'expdp version=2 2>&1 || echo "not found"'),
    list: () => [],
  },
};

function getEngine(type) {
  const engine = ENGINES[type];
  if (!engine) throw new Error(`Unsupported DB engine: ${type}`);
  return engine;
}

function isDumpCmd(cmdResult) {
  return typeof cmdResult === 'object' && cmdResult.cmd;
}

async function backup(backupConfig) {
  const { type, connection, backupPath, name } = backupConfig;
  const engine = getEngine(type);

  const toolCheck = engine.check();
  if (!toolCheck.available) {
    return { success: false, error: `${type} CLI tools not found on server` };
  }

  const outFile = `${backupPath}/${name}_${Date.now()}.${type === 'postgres' ? 'dump' : 'sql'}`;
  const dumpResult = engine.dump(connection, outFile);

  let result;
  if (isDumpCmd(dumpResult)) {
    result = run(dumpResult.cmd, { env: dumpResult.env, timeout: 600000 });
  } else {
    result = run(dumpResult, { timeout: 600000 });
  }

  return {
    success: result.success,
    file: outFile,
    error: result.stderr,
    size: result.success ? ((await require('fs').promises.stat(outFile))?.size || 0) : 0,
  };
}

async function restore(restoreConfig) {
  const { type, connection, file } = restoreConfig;
  const engine = getEngine(type);

  const toolCheck = engine.check();
  if (!toolCheck.available) {
    return { success: false, error: `${type} CLI tools not found on server` };
  }

  const restoreResult = engine.restore(connection, file);

  let result;
  if (isDumpCmd(restoreResult)) {
    result = run(restoreResult.cmd, { env: restoreResult.env, timeout: 600000 });
  } else {
    result = run(restoreResult, { timeout: 600000 });
  }

  return { success: result.success, error: result.stderr };
}

function listDatabases(type, conn) {
  const engine = getEngine(type);
  return engine.list(conn);
}

function checkTools(type) {
  const engine = getEngine(type);
  return engine.check();
}

module.exports = { backup, restore, listDatabases, checkTools, ENGINES };
