const { spawn, spawnSync } = require('child_process');

/**
 * Synchronously runs a command with arguments as an array.
 * This is safer than execSync with a string.
 */
function run(cmd, args = [], opts = {}) {
  try {
    const result = spawnSync(cmd, args, {
      timeout: opts.timeout || 300000,
      encoding: 'utf8',
      ...opts,
    });
    
    if (result.error) {
      return { success: false, stderr: result.error.message };
    }
    
    return {
      success: result.status === 0,
      stdout: result.stdout?.trim() || '',
      stderr: result.stderr?.trim() || ''
    };
  } catch (e) {
    return { success: false, stderr: e.message };
  }
}

/**
 * Asynchronously runs a command with arguments as an array.
 */
function runAsync(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    
    try {
      const p = spawn(cmd, args, {
        timeout: opts.timeout || 3600000, // default 1 hour
        ...opts,
      });

      if (p.stdout) {
        p.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (p.stderr) {
        p.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      p.on('error', (err) => {
        resolve({ success: false, stderr: err.message, stdout: stdout.trim() });
      });

      p.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });
    } catch (err) {
      resolve({ success: false, stderr: err.message, stdout: '' });
    }
  });
}

/**
 * Checks if a CLI tool is available by running a version check command.
 */
function checkTool(name, checkCmd, checkArgs = ['--version']) {
  // If checkCmd is a string with spaces, it might be legacy code. 
  // Let's try to handle it or encourage array-based args.
  if (typeof checkCmd === 'string' && checkCmd.includes(' ')) {
    const parts = checkCmd.split(' ');
    const r = run(parts[0], parts.slice(1));
    return r.success ? { available: true, version: r.stdout } : { available: false };
  }
  
  const r = run(name, checkArgs);
  return r.success ? { available: true, version: r.stdout } : { available: false };
}

const os = require('os');
const path = require('path');

/**
 * Gets real disk statistics for a path.
 */
function getDiskStats(dirPath) {
  const absolutePath = path.resolve(dirPath);
  try {
    if (os.platform() === 'win32') {
      const drive = absolutePath.substring(0, 1);
      const result = spawnSync('powershell', ['-NoProfile', '-Command', `Get-Volume -DriveLetter ${drive} | Select-Object SizeRemaining, Size`], { encoding: 'utf8' });
      if (result.status === 0) {
        const lines = result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          const free = parseInt(parts[0], 10);
          const total = parseInt(parts[1], 10);
          return { free, total };
        }
      }
    } else {
      const result = spawnSync('df', ['-B1', absolutePath], { encoding: 'utf8' });
      if (result.status === 0) {
        const lines = result.stdout.split('\n');
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
  return { free: 1024 * 1024 * 1024, total: 10 * 1024 * 1024 * 1024 }; // Fallback
}

module.exports = { run, runAsync, checkTool, getDiskStats };
