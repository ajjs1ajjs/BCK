const { db } = require('../services/db');
const logger = require('../services/logger');

const getSettings = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(row => {
    settings[row.key] = JSON.parse(row.value);
  });
  return settings;
};

const ipAllowlistMiddleware = (req, res, next) => {
  const settings = getSettings();
  const allowedIps = settings.security?.allowedIps;
  
  if (!allowedIps || allowedIps.trim() === '') {
    return next();
  }

  const clientIp = req.ip || req.connection.remoteAddress;
  const list = allowedIps.split(',').map(ip => ip.trim());

  if (list.includes(clientIp) || list.includes('127.0.0.1') || list.includes('::1')) {
    return next();
  }

  logger.warn(`Blocked request from unauthorized IP: ${clientIp}`);
  res.status(403).json({ error: 'Access denied: IP not allowed' });
};

module.exports = ipAllowlistMiddleware;
