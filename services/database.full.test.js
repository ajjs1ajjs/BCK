const { backup, restore, checkTools, listDatabases } = require('./database');
const { runAsync, checkTool } = require('./exec');
const { spawn } = require('child_process');
const { Readable, Writable } = require('stream');

// Mock the runAsync and checkTool functions
jest.mock('./exec', () => ({
  runAsync: jest.fn(),
  checkTool: jest.fn()
}));

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

describe('Database Service Tests', () => {
  beforeEach(() => {
    runAsync.mockReset();
    checkTool.mockReset();
    spawn.mockReset();
  });

  test('should export backup, restore, checkTools and listDatabases functions', () => {
    expect(typeof backup).toBe('function');
    expect(typeof restore).toBe('function');
    expect(typeof checkTools).toBe('function');
    expect(typeof listDatabases).toBe('function');
  });

  test('should handle MySQL backup correctly', async () => {
    checkTool.mockReturnValue({ available: true, version: '8.0.0' });
    
    const mockProcess = {
      stdout: new Readable({ read() { this.push(null); } }),
      stdin: new Writable({ write(chunk, encoding, callback) { callback(); } }),
      stderr: new Readable({ read() { this.push(null); } }),
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockProcess;
      })
    };
    spawn.mockReturnValue(mockProcess);
    
    const result = await backup({
      type: 'mysql',
      connection: { 
        host: 'localhost',
        port: 3306,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb'
      },
      backupPath: '/tmp',
      name: 'test_mysql'
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  test('should handle PostgreSQL backup correctly', async () => {
    checkTool.mockReturnValue({ available: true, version: '12.0.0' });
    
    const mockProcess = {
      stdout: new Readable({ read() { this.push(null); } }),
      stdin: new Writable({ write(chunk, encoding, callback) { callback(); } }),
      stderr: new Readable({ read() { this.push(null); } }),
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockProcess;
      })
    };
    spawn.mockReturnValue(mockProcess);
    
    const result = await backup({
      type: 'postgres',
      connection: { 
        host: 'localhost',
        port: 5432,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb'
      },
      backupPath: '/tmp',
      name: 'test_postgres'
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  test('should handle Oracle backup correctly', async () => {
    checkTool.mockReturnValue({ available: true, version: '19c' });
    runAsync.mockResolvedValue({ success: true, stdout: '' });
    
    const result = await backup({
      type: 'oracle',
      connection: { 
        host: 'localhost',
        port: 1521,
        user: 'testuser',
        password: 'testpass',
        service: 'ORCL',
        oracleHome: '/u01/app/oracle/product/19.0.0/dbhome_1'
      },
      backupPath: '/tmp',
      name: 'test_oracle'
    });

    expect(result.success).toBe(true);
  });

  test('should handle MySQL restore correctly', async () => {
    checkTool.mockReturnValue({ available: true, version: '8.0.0' });
    
    const mockProcess = {
      stdout: new Readable({ read() { this.push(null); } }),
      stdin: new Writable({ write(chunk, encoding, callback) { callback(); } }),
      stderr: new Readable({ read() { this.push(null); } }),
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockProcess;
      })
    };
    spawn.mockReturnValue(mockProcess);
    
    const result = await restore({
      type: 'mysql',
      connection: { 
        host: 'localhost',
        port: 3306,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb'
      },
      file: '/tmp/test.sql'
    });

    expect(result.success).toBe(true);
  });

  test('should handle PostgreSQL restore correctly', async () => {
    checkTool.mockReturnValue({ available: true, version: '12.0.0' });
    
    const mockProcess = {
      stdout: new Readable({ read() { this.push(null); } }),
      stdin: new Writable({ write(chunk, encoding, callback) { callback(); } }),
      stderr: new Readable({ read() { this.push(null); } }),
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockProcess;
      })
    };
    spawn.mockReturnValue(mockProcess);
    
    const result = await restore({
      type: 'postgres',
      connection: { 
        host: 'localhost',
        port: 5432,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb'
      },
      file: '/tmp/test.dump'
    });

    expect(result.success).toBe(true);
  });

  test('should handle Oracle restore correctly', async () => {
    checkTool.mockReturnValue({ available: true, version: '19c' });
    runAsync.mockResolvedValue({ success: true, stdout: '' });
    
    const result = await restore({
      type: 'oracle',
      connection: { 
        host: 'localhost',
        port: 1521,
        user: 'testuser',
        password: 'testpass',
        service: 'ORCL',
        oracleHome: '/u01/app/oracle/product/19.0.0/dbhome_1'
      },
      file: '/tmp/test.dmp'
    });

    expect(result.success).toBe(true);
  });

  test('should check MySQL tool correctly', () => {
    checkTool.mockReturnValue({ available: true, version: '8.0.0' });
    const result = checkTools('mysql');
    expect(result).toEqual({ available: true, version: '8.0.0' });
  });

  test('should check PostgreSQL tool correctly', () => {
    checkTool.mockReturnValue({ available: true, version: '12.0.0' });
    const result = checkTools('postgres');
    expect(result).toEqual({ available: true, version: '12.0.0' });
  });

  test('should check Oracle tool correctly', () => {
    checkTool.mockReturnValue({ available: true, version: '19c' });
    const result = checkTools('oracle');
    expect(result).toEqual({ available: true, version: '19c' });
  });

  test('should list MySQL databases correctly', async () => {
    runAsync.mockResolvedValue({ 
      success: true, 
      stdout: 'database1\ndatabase2\n' 
    });
    
    const result = await listDatabases('mysql', { 
      host: 'localhost',
      port: 3306,
      user: 'testuser',
      password: 'testpass'
    });

    expect(result).toEqual(['database1', 'database2']);
  });
});