const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../services/config');

const authenticate = (req, res, next) => {
  const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
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

module.exports = {
  authenticate,
  authorize
};
