const { emit, EVENT_TYPES } = require('./webhooks');
const { db } = require('./db');

describe('Webhook Service Tests', () => {
  beforeAll(async () => {
    try {
      await db.run('DELETE FROM webhook_endpoints');
      await db.run('DELETE FROM webhook_deliveries');
    } catch (e) {}
  });

  afterEach(async () => {
    try {
      await db.run('DELETE FROM webhook_endpoints');
      await db.run('DELETE FROM webhook_deliveries');
    } catch (e) {}
  });

  test('should expose supported event types', () => {
    expect(EVENT_TYPES).toContain('backup.started');
    expect(EVENT_TYPES).toContain('backup.completed');
    expect(EVENT_TYPES).toContain('backup.failed');
    expect(EVENT_TYPES).toContain('system.alert');
  });

  test('should emit event and check SQLite lookup safely', async () => {
    await expect(emit('backup.completed', { id: '123' })).resolves.not.toThrow();
  });

  test('should filter out mismatched webhook subscriptions', async () => {
    // Inject a disabled webhook
    await db.prepare(`
      INSERT INTO webhook_endpoints (id, name, url, secret, events, retries, active, orgId, createdAt)
      VALUES ('test-id', 'Test WH', 'http://localhost/ping', 'secret', '["backup.failed"]', 3, 1, 'default', '2026-05-29')
    `).run();

    // Emitting backup.completed should not match
    await emit('backup.completed', { id: 'abc' });
    const count = (await db.get('SELECT COUNT(*) as count FROM webhook_deliveries')).count;
    expect(count).toBe(0);
  });
});
