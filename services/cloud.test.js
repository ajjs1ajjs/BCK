const { backup, restore, checkTools, PROVIDERS } = require('./cloud');
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

  test('should export backup, restore, checkTools and PROVIDERS functions', () => {
    expect(typeof backup).toBe('function');
    expect(typeof restore).toBe('function');
    expect(typeof checkTools).toBe('function');
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

    expect(result).toEqual({ success: false, error: 'Unsupported provider' });
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

    expect(result).toEqual({ success: false, error: 'Unsupported provider' });
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
});