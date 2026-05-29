const crypto = require('crypto');

// Use a fixed salt for key derivation. In a more advanced setup, 
// this could be stored in the DB or a separate config.
const SALT = process.env.ENCRYPTION_SALT || 'bck-default-salt-do-not-change';

/**
 * Derives a 32-byte key from the environment variable using scrypt.
 */
function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) return null;
  
  // If the secret is already a 64-char hex (32 bytes), use it directly
  if (secret.length === 64 && /^[0-9a-fA-F]+$/.test(secret)) {
    try {
      return Buffer.from(secret, 'hex');
    } catch (e) {
      // Fallback
    }
  }
  
  // Otherwise, derive the key using scrypt
  return crypto.scryptSync(secret, SALT, 32);
}

/**
 * Encrypts text using AES-256-GCM.
 * Format: iv:encryptedData:authTag
 */
function encrypt(text) {
  if (!text) return '';
  const key = getEncryptionKey();
  if (!key) return text;
  
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
  } catch (err) {
    console.error('Encryption failed:', err.message);
    return text;
  }
}

/**
 * Decrypts text using AES-256-GCM.
 */
function decrypt(text) {
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length !== 3) return text;
  
  const key = getEncryptionKey();
  if (!key) return text;
  
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    // If decryption fails, it might be using the old SHA-256 derivation
    // Fallback to old method to avoid data loss during transition
    try {
      const oldKey = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const authTag = Buffer.from(parts[2], 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', oldKey, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      return text;
    }
  }
}

const fs = require('fs');
const fsPromises = require('fs').promises;

async function encryptFile(srcPath, destPath, password) {
  const key = crypto.scryptSync(password || process.env.ENCRYPTION_KEY || 'bck-fallback-pass', SALT, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  const input = fs.createReadStream(srcPath);
  const output = fs.createWriteStream(destPath);
  
  await new Promise((resolve, reject) => {
    output.write(iv, (err) => {
      if (err) return reject(err);
      input.pipe(cipher).pipe(output);
    });
    output.on('finish', resolve);
    output.on('error', reject);
    input.on('error', reject);
  });
}

async function decryptFile(srcPath, destPath, password) {
  const key = crypto.scryptSync(password || process.env.ENCRYPTION_KEY || 'bck-fallback-pass', SALT, 32);
  
  const fd = await fsPromises.open(srcPath, 'r');
  const buffer = Buffer.alloc(16);
  await fd.read(buffer, 0, 16, 0);
  await fd.close();
  
  const iv = buffer;
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  
  const input = fs.createReadStream(srcPath, { start: 16 });
  const output = fs.createWriteStream(destPath);
  
  await new Promise((resolve, reject) => {
    input.pipe(decipher).pipe(output);
    output.on('finish', resolve);
    output.on('error', reject);
    input.on('error', reject);
  });
}

module.exports = { encrypt, decrypt, encryptFile, decryptFile };
