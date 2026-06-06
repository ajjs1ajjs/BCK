const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { db } = require('./db');
const logger = require('./logger');

const getSettings = async () => {
  const rows = await db.all('SELECT key, value FROM settings');
  const settings = {};
  rows.forEach(row => {
    settings[row.key] = JSON.parse(row.value);
  });
  return settings;
};

const updateSetting = async (key, value) => {
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', key, JSON.stringify(value));
};

const addLog = async (message, status = 'info') => {
  try {
    await db.run('INSERT INTO logs (id, timestamp, message, status) VALUES (?, ?, ?, ?)', uuidv4(), new Date().toISOString(), message, status);
    
    const count = (await db.get('SELECT COUNT(*) as count FROM logs')).count;
    if (count > 500) {
      await db.run('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?)', count - 500);
    }
  } catch (err) {
    logger.error('Failed to add log: ' + err.message);
  }
  
  if (status === 'error' || status === 'failed') {
    logger.error(message);
  } else {
    logger.info(message);
  }
};

async function sendNotification(message, status) {
  const settings = await getSettings();
  const { notifications, smtp } = settings;

  if (notifications.email && smtp.host && smtp.user && smtp.password) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port || 587,
        secure: (smtp.encryption || 'tls') === 'ssl',
        auth: { user: smtp.user, pass: smtp.password },
      });
      await transporter.sendMail({
        from: smtp.from || smtp.user,
        to: notifications.email,
        subject: `[BCK] ${status === 'success' ? '✓' : '✗'} ${message}`,
        text: message,
      });
    } catch (e) {
      console.error('Email notification failed:', e.message);
    }
  }

  if (notifications.slack) {
    try {
      await fetch(notifications.slack, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `[BCK] ${status === 'success' ? '✓' : '✗'} ${message}` }),
      });
    } catch (e) {
      console.error('Slack notification failed:', e.message);
    }
  }

  if (notifications.discord) {
    try {
      await fetch(notifications.discord, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `[BCK] ${status === 'success' ? '✓' : '✗'} ${message}` }),
      });
    } catch (e) {
      console.error('Discord notification failed:', e.message);
    }
  }

  if (notifications.telegram && notifications.telegramBotToken) {
    try {
      const chatId = notifications.telegram;
      const text = encodeURIComponent(`[BCK] ${status === 'success' ? '✓' : '✗'} ${message}`);
      await fetch(`https://api.telegram.org/bot${notifications.telegramBotToken}/sendMessage?chat_id=${chatId}&text=${text}`);
    } catch (e) {
      console.error('Telegram notification failed:', e.message);
    }
  }

  if (notifications.webhook) {
    try {
      await fetch(notifications.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'backup', status, message, timestamp: new Date().toISOString() }),
      });
    } catch (e) {
      console.error('Webhook notification failed:', e.message);
    }
  }

  try {
    const webhooks = require('./webhooks');
    webhooks.emit('system.alert', { status, message });
  } catch (e) {
    console.error('Failed to emit system alert webhook:', e.message);
  }
}

const pruneLogs = async () => {
  try {
    const settings = await getSettings();
    const retentionDays = (settings.retention && settings.retention.days) || 30;
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - retentionDays);
    const thresholdStr = thresholdDate.toISOString();
    
    const result = await db.run('DELETE FROM logs WHERE timestamp < ?', thresholdStr);
    logger.info(`Pruned system logs older than ${retentionDays} days. Deleted ${result.changes} logs.`);
  } catch (err) {
    logger.error('Failed to prune system logs: ' + err.message);
  }
};

module.exports = {
  getSettings,
  updateSetting,
  addLog,
  sendNotification,
  pruneLogs,
};
