const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { JWT_SECRET } = require('../services/config');

// Lazy-load db to avoid circular deps
let _db = null;
function getDb() {
  if (!_db) _db = require('../services/db').db;
  return _db;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.token;

  // ── API Token authentication (bck_ prefix) ──────────────────────────────
  const rawToken = authHeader?.startsWith('Bearer bck_')
    ? authHeader.split(' ')[1]
    : cookieToken?.startsWith?.('bck_') ? cookieToken : null;

  if (rawToken) {
    const db = getDb();
    const hashed = hashToken(rawToken);
    const apiToken = db.prepare('SELECT * FROM api_tokens WHERE tokenHash = ?').get(hashed);

    if (!apiToken) return res.status(401).json({ error: 'Invalid API token' });

    // Check expiry
    if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'API token has expired' });
    }

    // Lookup associated user
    const user = db.prepare('SELECT id, username, role, email FROM users WHERE id = ? AND active = 1').get(apiToken.userId);
    if (!user) return res.status(401).json({ error: 'Token user not found or inactive' });

    // Fetch role permissions
    const role = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(user.role);
    const rolePermissions = role ? JSON.parse(role.permissions) : {};
    const tokenPermissions = JSON.parse(apiToken.permissions || '{}');

    // Effective permissions = intersection of role perms and token perms (if token restricts)
    const hasTokenPerms = Object.keys(tokenPermissions).length > 0;
    const permissions = hasTokenPerms
      ? Object.fromEntries(Object.entries(rolePermissions).map(([k, v]) => [k, v && tokenPermissions[k] !== false]))
      : rolePermissions;

    // Update lastUsedAt asynchronously (don't block request)
    setImmediate(() => {
      try {
        db.prepare('UPDATE api_tokens SET lastUsedAt = ? WHERE id = ?').run(new Date().toISOString(), apiToken.id);
      } catch (e) {}
    });

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      orgId: apiToken.orgId || 'default',
      permissions,
      authMethod: 'api_token',
    };
    return next();
  }

  // ── JWT authentication ───────────────────────────────────────────────────
  const jwtRaw = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : cookieToken;
  if (!jwtRaw) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(jwtRaw, JWT_SECRET);
    req.user = {
      ...decoded,
      orgId: decoded.orgId || 'default',
      authMethod: 'jwt',
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const authorize = (permission) => {
  return (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.permissions?.[permission])) {
      return next();
    }
    return res.status(403).json({ error: `Forbidden: requires ${permission} permission` });
  };
};

module.exports = { authenticate, authorize };
