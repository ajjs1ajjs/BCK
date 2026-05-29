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

module.exports = { run, runAsync, checkTool };
