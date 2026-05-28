const { run, runAsync, checkTool } = require('./exec');

describe('Exec Service Tests', () => {
  test('should export run, runAsync and checkTool functions', () => {
    expect(typeof run).toBe('function');
    expect(typeof runAsync).toBe('function');
    expect(typeof checkTool).toBe('function');
  });

  test('run should execute command successfully', () => {
    const result = run('node --version');
    expect(result.success).toBe(true);
    expect(result.stdout).toBeTruthy();
  });

  test('run should handle command failure', () => {
    const result = run('nonexistent-command-xyz123');
    expect(result.success).toBe(false);
  });

  test('runAsync should execute command successfully', async () => {
    const result = await runAsync('node', ['-e', 'console.log("hello")']);
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('hello');
  });

  test('runAsync should handle command failure', async () => {
    const result = await runAsync('node', ['-e', 'process.stderr.write("err"); process.exit(1)']);
    expect(result.success).toBe(false);
    expect(result.stderr).toBe('err');
  });

  test('checkTool should detect available commands', () => {
    const result = checkTool('node', 'node --version');
    expect(result.available).toBe(true);
    expect(result.version).toBeTruthy();
  });

  test('checkTool should detect unavailable commands', () => {
    const result = checkTool('nonexistent-cmd-abc123', 'nonexistent-cmd-abc123 --version');
    expect(result.available).toBe(false);
  });

  test('runAsync should handle timeout correctly', async () => {
    const result = await runAsync('node', ['-e', 'setTimeout(() => {}, 60000)'], { timeout: 100 });
    expect(result.success).toBe(false);
  });
});