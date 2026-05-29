const { backup, restore, checkTools, PROVIDERS, list } = require('./cloud');
const { runAsync, checkTool } = require('./exec');

// Mock the runAsync and checkTool functions to prevent actual system calls during tests
jest.mock('./exec', () => ({
  runAsync: jest.fn(),
  checkTool: jest.fn()
}));

describe('Cloud Service Tests', () => {
  beforeEach(() => {
    // Reset mocks before each test
    runAsync.mockReset();
    checkTool.mockReset();
  });

  test('should export backup, restore, checkTools, list and PROVIDERS functions', () => {
    expect(typeof backup).toBe('function');
    expect(typeof restore).toBe('function');
    expect(typeof checkTools).toBe('function');
    expect(typeof list).toBe('function');
    expect(typeof PROVIDERS).toBe('object');
  });

  test('should handle AWS provider correctly in backup', async () => {
    checkTool.mockReturnValue({ available: true, version: 'aws-cli' });
    runAsync.mockResolvedValue({ success: true, stderr: '' });
    
    const result = await backup(
      { 
        provider: 'aws',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          region: 'us-east-1',
          bucket: 'test-bucket'
        }
      },
      '/path/to/source',
      '/path/to/destination'
    );

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle Azure provider correctly in backup', async () => {
    checkTool.mockReturnValue({ available: true, version: 'azure-cli' });
    runAsync.mockResolvedValue({ success: true, stderr: '' });
    
    const result = await backup(
      { 
        provider: 'azure',
        credentials: {
          storageAccount: 'test-account',
          accessKey: 'test-key',
          container: 'test-container'
        }
      },
      '/path/to/source',
      '/path/to/destination'
    );

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle GCP provider correctly in backup', async () => {
    checkTool.mockReturnValue({ available: true, version: 'gcloud' });
    runAsync.mockResolvedValue({ success: true, stderr: '' });
    
    const result = await backup(
      { 
        provider: 'gcp',
        credentials: {
          projectId: 'test-project',
          bucket: 'test-bucket',
          credentials: { private_key: 'test-key' }
        }
      },
      '/path/to/source',
      '/path/to/destination'
    );

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle unsupported provider in backup', async () => {
    const result = await backup(
      { 
        provider: 'unsupported',
        credentials: {}
      },
      '/path/to/source',
      '/path/to/destination'
    );

    expect(result).toEqual({ success: false, error: 'Unsupported cloud provider: unsupported' });
  });

  test('should handle AWS provider correctly in restore', async () => {
    checkTool.mockReturnValue({ available: true, version: 'aws-cli' });
    runAsync.mockResolvedValue({ success: true, stderr: '' });
    
    const result = await restore(
      { 
        provider: 'aws',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          region: 'us-east-1',
          bucket: 'test-bucket'
        }
      },
      '/path/to/source',
      '/path/to/destination'
    );

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle Azure provider correctly in restore', async () => {
    checkTool.mockReturnValue({ available: true, version: 'azure-cli' });
    runAsync.mockResolvedValue({ success: true, stderr: '' });
    
    const result = await restore(
      { 
        provider: 'azure',
        credentials: {
          storageAccount: 'test-account',
          accessKey: 'test-key',
          container: 'test-container'
        }
      },
      '/path/to/source',
      '/path/to/destination'
    );

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle GCP provider correctly in restore', async () => {
    checkTool.mockReturnValue({ available: true, version: 'gcloud' });
    runAsync.mockResolvedValue({ success: true, stderr: '' });
    
    const result = await restore(
      { 
        provider: 'gcp',
        credentials: {
          projectId: 'test-project',
          bucket: 'test-bucket',
          credentials: { private_key: 'test-key' }
        }
      },
      '/path/to/source',
      '/path/to/destination'
    );

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle unsupported provider in restore', async () => {
    const result = await restore(
      { 
        provider: 'unsupported',
        credentials: {}
      },
      '/path/to/source',
      '/path/to/destination'
    );

    expect(result).toEqual({ success: false, error: 'Unsupported cloud provider: unsupported' });
  });

  test('should check tools for AWS correctly', () => {
    checkTool.mockReturnValue({ available: true, version: 'aws-cli' });
    const result = checkTools('aws');
    expect(typeof result).toBe('object');
    expect(result.available).toBe(true);
  });

  test('should check tools for Azure correctly', () => {
    checkTool.mockReturnValue({ available: true, version: 'azure-cli' });
    const result = checkTools('azure');
    expect(typeof result).toBe('object');
    expect(result.available).toBe(true);
  });

  test('should check tools for GCP correctly', () => {
    checkTool.mockReturnValue({ available: true, version: 'gcloud' });
    const result = checkTools('gcp');
    expect(typeof result).toBe('object');
    expect(result.available).toBe(true);
  });

  test('should return available: false for unknown provider in checkTools', () => {
    checkTool.mockReturnValue({ available: false, version: undefined });
    const result = checkTools('unknown');
    expect(result).toEqual({ available: false });
  });

  test('should have correct PROVIDERS structure', () => {
    expect(PROVIDERS.aws).toBeDefined();
    expect(PROVIDERS.azure).toBeDefined();
    expect(PROVIDERS.gcp).toBeDefined();
  });

  test('should list AWS objects successfully', async () => {
    runAsync.mockResolvedValue({
      success: true,
      stdout: '2026-05-29 12:00:00        1024 backup_file.sql.gz\n'
    });
    const result = await list({
      provider: 'aws',
      credentials: { bucket: 'test-bucket' }
    });
    expect(result).toEqual([{ date: '2026-05-29 12:00:00', size: '1024', key: 'backup_file.sql.gz' }]);
  });

  test('should throw error when AWS list fails', async () => {
    runAsync.mockResolvedValue({
      success: false,
      stderr: 'Access Denied'
    });
    await expect(list({
      provider: 'aws',
      credentials: { bucket: 'test-bucket' }
    })).rejects.toThrow('Access Denied');
  });

  test('should list Azure blobs successfully', async () => {
    runAsync.mockResolvedValue({
      success: true,
      stdout: '[{"name": "file1", "size": 500}]'
    });
    const result = await list({
      provider: 'azure',
      credentials: { storageAccount: 'acc', accessKey: 'key', container: 'cont' }
    });
    expect(result).toEqual([{ name: 'file1', size: 500 }]);
  });

  test('should throw error when Azure list fails', async () => {
    runAsync.mockResolvedValue({
      success: false,
      stderr: 'Auth error'
    });
    await expect(list({
      provider: 'azure',
      credentials: { storageAccount: 'acc', accessKey: 'key', container: 'cont' }
    })).rejects.toThrow('Auth error');
  });

  test('should list GCP objects successfully', async () => {
    runAsync.mockResolvedValue({
      success: true,
      stdout: '     1024  gs://test-bucket/file1\n'
    });
    const result = await list({
      provider: 'gcp',
      credentials: { bucket: 'test-bucket', credentials: {} }
    });
    expect(result).toEqual([{ size: '1024', key: 'gs://test-bucket/file1' }]);
  });

  test('should throw error when GCP list fails', async () => {
    runAsync.mockResolvedValue({
      success: false,
      stderr: 'Bucket not found'
    });
    await expect(list({
      provider: 'gcp',
      credentials: { bucket: 'test-bucket', credentials: {} }
    })).rejects.toThrow('Bucket not found');
  });

  test('should throw error for unsupported provider in list', async () => {
    await expect(list({
      provider: 'unsupported',
      credentials: {}
    })).rejects.toThrow('Unsupported cloud provider: unsupported');
  });
});