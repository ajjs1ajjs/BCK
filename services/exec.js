const { execSync, spawn } = require('child_process');

function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      timeout: opts.timeout || 300000,
      stdio: 'pipe',
      ...opts,
    });
    return { success: true, stdout: out.toString().trim() };
  } catch (e) {
    return { success: false, stderr: e.stderr?.toString() || e.message };
  }
}

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
        resolve({ success: false, stderr: err.message, stdout });
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

function checkTool(name, checkCmd) {
  const r = run(checkCmd);
  return r.success ? { available: true, version: r.stdout } : { available: false };
}

module.exports = { run, runAsync, checkTool };
