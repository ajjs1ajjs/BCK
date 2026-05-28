const { runAsync, checkTool } = require('./exec');

test('checkTool returns available:false for non-existent command', () => {
  const result = checkTool('nonexistent-cmd-abc123', 'nonexistent-cmd-abc123 --version');
  expect(result.available).toBe(false);
});

test('checkTool returns available:true for known command', () => {
  const result = checkTool('node', 'node --version');
  expect(result.available).toBe(true);
  expect(result.version).toBeTruthy();
});

test('runAsync captures stdout', async () => {
  const result = await runAsync('node', ['-e', 'console.log("hello")']);
  expect(result.success).toBe(true);
  expect(result.stdout).toBe('hello');
});

test('runAsync captures stderr on failure', async () => {
  const result = await runAsync('node', ['-e', 'process.stderr.write("err"); process.exit(1)']);
  expect(result.success).toBe(false);
  expect(result.stderr).toBe('err');
});
