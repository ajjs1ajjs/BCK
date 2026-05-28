const { backup, restore, checkTools } = require('./vm');
const { runAsync, checkTool } = require('./exec');

// Mock the runAsync and checkTool functions to prevent actual system calls during tests
jest.mock('./exec', () => ({
  runAsync: jest.fn(),
  checkTool: jest.fn()
}));

describe('VM Service Tests', () => {
  beforeEach(() => {
    // Reset mocks before each test
    runAsync.mockReset();
    checkTool.mockReset();
  });

  test('should export backup, restore and checkTools functions', () => {
    expect(typeof backup).toBe('function');
    expect(typeof restore).toBe('function');
    expect(typeof checkTools).toBe('function');
  });

  test('should handle VMware backup correctly', async () => {
    checkTool.mockReturnValue({ available: true, version: 'vSphere CLI' });
    runAsync.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    
    const result = await backup({
      type: 'vmware',
      vmName: 'test-vm',
      host: 'https://test-host',
      user: 'test-user',
      password: 'test-pass',
      datastore: 'test-datastore',
      backupPath: '/tmp'
    });

    expect(result.success).toBe(true);
    expect(result.error).toBe('');
  });

  test('should handle VMware backup with missing tool', async () => {
    checkTool.mockReturnValue({ available: false, version: undefined });
    
    const result = await backup({
      type: 'vmware',
      vmName: 'test-vm',
      host: 'https://test-host',
      user: 'test-user',
      password: 'test-pass',
      datastore: 'test-datastore',
      backupPath: '/tmp'
    });

    expect(result).toEqual({ success: false, error: 'govc CLI not found. Install VMware vSphere CLI.' });
  });

  test('should handle Hyper-V backup correctly', async () => {
    checkTool.mockReturnValue({ available: true, version: 'PowerShell' });
    runAsync.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    
    const result = await backup({
      type: 'hyperv',
      vmName: 'test-vm',
      backupPath: '/tmp'
    });

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle unsupported VM type in backup', async () => {
    const result = await backup({
      type: 'unsupported',
      vmName: 'test-vm',
      backupPath: '/tmp'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported VM platform');
  });

  test('should handle VMware restore correctly', async () => {
    runAsync.mockResolvedValue({ success: true, stdout: '', stderr: '' });

    const result = await restore({
      type: 'vmware',
      vmName: 'test-vm',
      host: 'https://test-host',
      user: 'test-user',
      password: 'test-pass',
      file: '/tmp/test-vm.ova'
    });

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle Hyper-V restore correctly', async () => {
    runAsync.mockResolvedValue({ success: true, stdout: '', stderr: '' });

    const result = await restore({
      type: 'hyperv',
      vmName: 'test-vm',
      file: '/tmp/test-vm'
    });

    expect(result).toEqual({ success: true, error: '' });
  });

  test('should handle unsupported VM type in restore', async () => {
    const result = await restore({
      type: 'unsupported',
      vmName: 'test-vm',
      file: '/tmp/test-vm'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported VM platform');
  });

  test('should check VMware tools correctly', () => {
    checkTool.mockReturnValue({ available: true, version: 'govc version' });
    const result = checkTools('vmware');
    expect(result).toEqual({ available: true, version: 'govc version' });
  });

  test('should check Hyper-V tools correctly', () => {
    checkTool.mockReturnValue({ available: true, version: 'PowerShell' });
    const result = checkTools('hyperv');
    expect(result).toEqual({ available: true, version: 'PowerShell' });
  });

  test('should return available false for unsupported type in checkTools', () => {
    const result = checkTools('unsupported');
    expect(result).toEqual({ available: false });
  });
});