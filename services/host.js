const path = require('path');
const fs = require('fs').promises;
const { runAsync, checkTool } = require('./exec');

const DEFAULT_EXCLUDES = [
  '/dev',
  '/proc',
  '/sys',
  '/run',
  '/tmp',
  '/mnt',
  '/media',
  '/lost+found',
];

function normalizeExclude(excludePath) {
  return String(excludePath || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function buildTarExcludes(sourcePath, backupPath, excludes = []) {
  const source = path.resolve(sourcePath || '/');
  const destination = path.resolve(backupPath || '.');
  const allExcludes = [...DEFAULT_EXCLUDES, destination, ...excludes].map(normalizeExclude).filter(Boolean);

  return allExcludes.map((excludePath) => {
    if (source === path.parse(source).root) return `--exclude=${excludePath}`;
    const relative = path.relative(source, excludePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return `--exclude=${excludePath}`;
    return `--exclude=${relative.replace(/\\/g, '/')}`;
  });
}

async function backup(backupConfig) {
  const { name, sourcePath, backupPath, excludes } = backupConfig;
  const source = path.resolve(sourcePath || '/');
  const destination = path.resolve(backupPath || '.');

  const tool = checkTool('tar', 'tar --version');
  if (!tool.available) {
    return { success: false, error: 'tar not found. Install tar to create host backups.' };
  }

  await fs.access(source);
  await fs.mkdir(destination, { recursive: true });

  const safeName = String(name || 'host').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outFile = path.join(destination, `${safeName}_${Date.now()}.tar.gz`);
  const args = [
    '-czpf',
    outFile,
    '--one-file-system',
    ...buildTarExcludes(source, destination, excludes),
    '-C',
    source,
    '.',
  ];

  const result = await runAsync('tar', args, { timeout: 24 * 60 * 60 * 1000 });
  let size = 0;
  if (result.success) {
    try {
      const stat = await fs.stat(outFile);
      size = stat.size;
    } catch {}
  }

  return { success: result.success, file: outFile, size, error: result.stderr };
}

async function restore(restoreConfig) {
  const { file, targetPath } = restoreConfig;
  const archive = path.resolve(file || '');
  const target = path.resolve(targetPath || '/');

  const tool = checkTool('tar', 'tar --version');
  if (!tool.available) {
    return { success: false, error: 'tar not found. Install tar to restore host backups.' };
  }

  await fs.access(archive);
  await fs.mkdir(target, { recursive: true });

  const result = await runAsync('tar', ['-xzpf', archive, '-C', target], { timeout: 24 * 60 * 60 * 1000 });
  return { success: result.success, error: result.stderr };
}

function checkTools() {
  return checkTool('tar', 'tar --version');
}

module.exports = { backup, restore, checkTools };
