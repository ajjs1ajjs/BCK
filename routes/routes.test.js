const mockStore = {};
const mockDb = {
  all: jest.fn(async (sql, ...params) => {
    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    const table = tableMatch ? tableMatch[1] : null;
    const data = Object.values(mockStore).filter(r => r._table === table);
    if (sql.includes('ORDER BY createdAt ASC') || sql.includes('ORDER BY "createdAt" ASC')) return data.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    if (sql.includes('ORDER BY createdAt DESC') || sql.includes('ORDER BY "createdAt" DESC')) return data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return data;
  }),
  get: jest.fn(async (sql, ...params) => {
    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    const table = tableMatch ? tableMatch[1] : null;
    if (sql.includes('COUNT(*)')) return { cnt: Object.values(mockStore).filter(r => r._table === table).length };
    const data = Object.values(mockStore).filter(r => r._table === table);
    const idCol = sql.includes('tokenHash') ? 'tokenHash' : sql.includes('slug') ? 'slug' : 'id';
    if (sql.includes('slug = ?')) return data.find(r => r.slug === params[0]) || null;
    return data.find(r => r[idCol] === params[0]) || null;
  }),
  run: jest.fn(async (sql, ...params) => {
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      const id = params[0];
      const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
      const table = tableMatch ? tableMatch[1] : null;
      if (!mockStore[id]) {
        mockStore[id] = { _table: table };
        const match = sql.match(/\(([^)]+)\)\s*VALUES/i);
        if (match) {
          const colSection = sql.substring(sql.indexOf('(') + 1, sql.indexOf(')'));
          const colNames = colSection.split(',').map(c => c.trim()).filter(c => c && !c.toUpperCase().startsWith('VALUES'));
          colNames.forEach((name, i) => {
            if (params[i] !== undefined) mockStore[id][name] = params[i];
          });
        }
      }
    }
    if (sql.trim().toUpperCase().startsWith('DELETE')) {
      const idCol = sql.includes('tokenHash') ? 'tokenHash' : 'id';
      Object.keys(mockStore).forEach(key => {
        if (mockStore[key][idCol] === params[0]) delete mockStore[key];
      });
    }
    if (sql.trim().toUpperCase().startsWith('UPDATE')) {
      const data = Object.values(mockStore).filter(r => r._table !== undefined);
      const target = data.find(r => r.id === params[params.length - 1]);
      if (target && sql.includes('name = ?')) target.name = params[0];
    }
  }),
};

jest.mock('../services/db', () => ({ db: mockDb }));
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(() => ({
    id: 'admin-user',
    username: 'admin',
    role: 'admin',
    permissions: { manageUsers: true, manageBackups: true, viewLogs: true, configure: true, restore: true },
  })),
}));
jest.mock('../services/helpers', () => ({ addLog: jest.fn() }));

process.env.JWT_SECRET = 'test-secret-for-jest';

const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

const organizationsRouter = require('./organizations');
const tokensRouter = require('./tokens');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.user = {
      id: 'admin-user',
      username: 'admin',
      role: 'admin',
      orgId: 'default',
      permissions: { manageUsers: true, manageBackups: true, viewLogs: true, configure: true, restore: true },
    };
    next();
  });
  app.use('/api', organizationsRouter);
  app.use('/api', tokensRouter);
  return app;
}

function resetStore() {
  Object.keys(mockStore).forEach(k => delete mockStore[k]);
}

describe('Organizations API', () => {
  let app;

  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    app = createApp();
  });

  test('GET /api/organizations returns empty list', async () => {
    const res = await request(app).get('/api/organizations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/organizations creates organization', async () => {
    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'Test Org', slug: 'test-org' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Org');
    expect(res.body.slug).toBe('test-org');
    expect(res.body.id).toBeDefined();
  });

  test('POST /api/organizations rejects missing slug', async () => {
    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'Test Org' });
    expect(res.status).toBe(400);
  });

  test('POST /api/organizations rejects invalid slug', async () => {
    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'Test Org', slug: 'TEST ORG!' });
    expect(res.status).toBe(400);
  });

  test('POST /api/organizations rejects duplicate slug', async () => {
    await request(app)
      .post('/api/organizations')
      .send({ name: 'Org 1', slug: 'dup' });
    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'Org 2', slug: 'dup' });
    expect(res.status).toBe(400);
  });

  test('GET /api/organizations returns created orgs', async () => {
    await request(app).post('/api/organizations').send({ name: 'B', slug: 'b-org' });
    await request(app).post('/api/organizations').send({ name: 'A', slug: 'a-org' });
    const res = await request(app).get('/api/organizations');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  test('PUT /api/organizations/:id updates name', async () => {
    const create = await request(app).post('/api/organizations').send({ name: 'Old', slug: 'old-org' });
    const id = create.body.id;
    const res = await request(app).put(`/api/organizations/${id}`).send({ name: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
  });

  test('PUT /api/organizations/default is rejected', async () => {
    const res = await request(app).put('/api/organizations/default').send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  test('DELETE /api/organizations/:id deletes org', async () => {
    const create = await request(app).post('/api/organizations').send({ name: 'Del', slug: 'del-org' });
    const res = await request(app).delete(`/api/organizations/${create.body.id}`);
    expect(res.status).toBe(200);
  });

  test('DELETE /api/organizations/default is rejected', async () => {
    const res = await request(app).delete('/api/organizations/default');
    expect(res.status).toBe(400);
  });
});

describe('Tokens API', () => {
  let app;

  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    app = createApp();
  });

  test('GET /api/tokens returns empty list', async () => {
    const res = await request(app).get('/api/tokens');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/tokens creates token', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .send({ name: 'test-token', permissions: { viewLogs: true } });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('test-token');
    expect(res.body.token).toMatch(/^bck_/);
    expect(res.body.warning).toBeDefined();
  });

  test('POST /api/tokens rejects empty name', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  test('GET /api/tokens returns created tokens', async () => {
    await request(app).post('/api/tokens').send({ name: 't1' });
    await request(app).post('/api/tokens').send({ name: 't2' });
    const res = await request(app).get('/api/tokens');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  test('DELETE /api/tokens/:id revokes token', async () => {
    const id = crypto.randomUUID();
    const hashed = crypto.createHash('sha256').update('bck_test').digest('hex');
    mockStore[id] = {
      _table: 'api_tokens',
      id,
      name: 'test',
      tokenHash: hashed,
      userId: 'admin-user',
      orgId: 'default',
      permissions: '{}',
      createdAt: new Date().toISOString(),
    };
    const res = await request(app).delete(`/api/tokens/${id}`);
    expect(res.status).toBe(200);
  });

  test('DELETE /api/tokens/:id returns 404 for non-existent', async () => {
    const res = await request(app).delete('/api/tokens/non-existent');
    expect(res.status).toBe(404);
  });
});
