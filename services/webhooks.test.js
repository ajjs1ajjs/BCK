let mockWebhookEndpoints = [];
let mockWebhookDeliveries = [];

const mockDb = {
  run: jest.fn(async (sql, ...params) => {
    if (sql.includes('DELETE FROM webhook_endpoints')) {
      mockWebhookEndpoints = [];
    } else if (sql.includes('DELETE FROM webhook_deliveries')) {
      mockWebhookDeliveries = [];
    } else if (sql.includes('INSERT INTO webhook_endpoints')) {
      mockWebhookEndpoints.push({
        id: 'test-id',
        name: 'Test WH',
        url: 'http://localhost/ping',
        secret: 'secret',
        events: '["backup.failed"]',
        retries: 3,
        active: 1,
        orgId: 'default',
        createdAt: '2026-05-29'
      });
    } else if (sql.includes('INSERT INTO webhook_deliveries')) {
      mockWebhookDeliveries.push({
        id: params[0],
        endpointId: params[1],
        event: params[2],
        status: params[3]
      });
    }
    return { changes: 1, lastInsertRowid: null };
  }),
  all: jest.fn(async (sql, ..._params) => {
    if (sql.includes('SELECT * FROM webhook_endpoints WHERE active = 1')) {
      return mockWebhookEndpoints.filter(ep => ep.active === 1);
    }
    return [];
  }),
  get: jest.fn(async (sql, ..._params) => {
    if (sql.includes('SELECT COUNT(*) as count FROM webhook_deliveries')) {
      return { count: mockWebhookDeliveries.length };
    }
    return null;
  })
};

jest.mock('./db', () => ({
  db: mockDb
}));

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
    await db.run(`
      INSERT INTO webhook_endpoints (id, name, url, secret, events, retries, active, orgId, createdAt)
      VALUES ('test-id', 'Test WH', 'http://localhost/ping', 'secret', '["backup.failed"]', 3, 1, 'default', '2026-05-29')
    `, );

    // Emitting backup.completed should not match
    await emit('backup.completed', { id: 'abc' });
    const count = (await db.get('SELECT COUNT(*) as count FROM webhook_deliveries')).count;
    expect(count).toBe(0);
  });
});
