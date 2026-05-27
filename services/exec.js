const { execSync } = require('child_process');

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

function checkTool(name, checkCmd) {
  const r = run(checkCmd);
  return r.success ? { available: true, version: r.stdout } : { available: false };
}

module.exports = { run, checkTool };
