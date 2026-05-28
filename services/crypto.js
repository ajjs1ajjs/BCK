const crypto = require('crypto');

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  if (key.length === 64) {
    try {
      return Buffer.from(key, 'hex');
    } catch {
      // Fallback if not valid hex
    }
  }
  return crypto.createHash('sha256').update(key).digest();
}

function encrypt(text) {
  if (!text) return '';
  const key = getEncryptionKey();
  if (!key) return text;
  
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

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
    return text;
  }
}

module.exports = { encrypt, decrypt };
