const { parseArgs } = require('./db');

describe('parseArgs', () => {
  test('no args returns query unchanged', () => {
    const { query, params } = parseArgs('SELECT * FROM users', []);
    expect(query).toBe('SELECT * FROM users');
    expect(params).toEqual([]);
  });

  test('replaces ? with $1, $2...', () => {
    const { query, params } = parseArgs('SELECT * FROM users WHERE id = ? AND name = ?', ['abc', 'test']);
    expect(query).toBe('SELECT * FROM users WHERE id = $1 AND name = $2');
    expect(params).toEqual(['abc', 'test']);
  });

  test('replaces @named params', () => {
    const { query, params } = parseArgs('INSERT INTO t (id, name) VALUES (@id, @name)', [{ id: '1', name: 'foo' }]);
    expect(query).toBe('INSERT INTO t (id, name) VALUES ($1, $2)');
    expect(params).toEqual(['1', 'foo']);
  });

  test('handles single array argument', () => {
    const { query, params } = parseArgs('SELECT * FROM t WHERE id = ?', [['abc']]);
    expect(query).toBe('SELECT * FROM t WHERE id = $1');
    expect(params).toEqual(['abc']);
  });

  test('handles no placeholders with args', () => {
    const { query, params } = parseArgs('SELECT 1', ['abc']);
    expect(query).toBe('SELECT 1');
    expect(params).toEqual(['abc']);
  });
});
