const { encrypt, decrypt } = require('./crypto');

describe('Crypto Utility Tests', () => {
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-secret-key-123456';
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalEnv;
  });

  test('should encrypt and decrypt a string correctly', () => {
    const secretText = 'super-secret-password-123!';
    const encryptedText = encrypt(secretText);
    
    expect(encryptedText).toBeDefined();
    expect(encryptedText).not.toBe(secretText);
    expect(encryptedText.split(':').length).toBe(3); // iv:ciphertext:tag

    const decryptedText = decrypt(encryptedText);
    expect(decryptedText).toBe(secretText);
  });

  test('should return raw text if encryption key is not set', () => {
    delete process.env.ENCRYPTION_KEY;
    const text = 'hello';
    const encrypted = encrypt(text);
    expect(encrypted).toBe(text);
    
    const decrypted = decrypt('some:encrypted:tag');
    expect(decrypted).toBe('some:encrypted:tag');
  });

  test('should return raw text for invalid encrypted formats during decryption', () => {
    const text = 'not-encrypted';
    const decrypted = decrypt(text);
    expect(decrypted).toBe(text);
  });

  test('should handle AES encryption with 64-character hex key', () => {
    // 64-character hex key is 32 bytes (256-bit)
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    const text = 'my-secret';
    const encrypted = encrypt(text);
    expect(decrypt(encrypted)).toBe(text);
  });
});
