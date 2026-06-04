/**
 * BCK Webhook Service
 * Supports: typed events, HMAC-SHA256 signing, automatic retries with backoff,
 * configurable per-endpoint event filters, delivery log.
 */
const crypto = require('crypto');
const { db } = require('./db');
const logger = require('./logger');
const cryptoHelper = require('./crypto');

// All event types emitted by BCK
const EVENT_TYPES = [
  'backup.started',
  'backup.completed',
  'backup.failed',
  'schedule.triggered',
  'restore.completed',
  'restore.failed',
  'user.login',
  'user.logout',
  'system.alert',
];

/**
 * Sign payload with HMAC-SHA256 using endpoint's secret
 */
function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Deliver a webhook to a single endpoint with retries
 */
async function deliverToEndpoint(endpoint, payload) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'X-BCK-Event': payload.event,
    'X-BCK-Delivery': payload.deliveryId,
    'X-BCK-Timestamp': String(payload.timestamp),
  };

  if (endpoint.secret) {
    try {
      const decryptedSecret = cryptoHelper.decrypt(endpoint.secret);
      headers['X-BCK-Signature'] = sign(decryptedSecret, body);
    } catch (e) {
      logger.error(`Failed to decrypt webhook secret for ${endpoint.url}: ${e.message}`);
    }
  }

  const MAX_ATTEMPTS = endpoint.retries || 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        // Log successful delivery
        try {
          await db.prepare(`
            INSERT INTO webhook_deliveries (id, endpointId, event, status, statusCode, attempt, deliveredAt)
            VALUES (?, ?, ?, 'success', ?, ?, ?)
          `).run(payload.deliveryId, endpoint.id, payload.event, res.status, attempt, new Date().toISOString());
        } catch (e) {}
        return { success: true, statusCode: res.status };
      }

      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }

    // Exponential backoff between retries
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  // Log failed delivery
  try {
    await db.prepare(`
      INSERT INTO webhook_deliveries (id, endpointId, event, status, statusCode, attempt, error, deliveredAt)
      VALUES (?, ?, ?, 'failed', NULL, ?, ?, ?)
    `).run(payload.deliveryId, endpoint.id, payload.event, MAX_ATTEMPTS, lastError, new Date().toISOString());
  } catch (e) {}

  return { success: false, error: lastError };
}

/**
 * Emit an event to all matching active webhook endpoints
 * @param {string} event - e.g. 'backup.completed'
 * @param {object} data  - event payload
 */
async function emit(event, data = {}) {
  let endpoints;
  try {
    endpoints = await db.all("SELECT * FROM webhook_endpoints WHERE active = 1");
  } catch (e) {
    return;
  }

  const matching = endpoints.filter(ep => {
    const events = JSON.parse(ep.events || '[]');
    return events.length === 0 || events.includes(event) || events.includes('*');
  });

  if (matching.length === 0) return;

  const deliveryId = crypto.randomUUID();
  const payload = {
    event,
    deliveryId,
    timestamp: Date.now(),
    data,
  };

  // Deliver to all matching endpoints in parallel (non-blocking)
  for (const ep of matching) {
    deliverToEndpoint(ep, payload).catch(e =>
      logger.error(`Webhook delivery failed for ${ep.url}: ${e.message}`)
    );
  }
}

/**
 * Test-fire a ping to a specific endpoint (for UI test button)
 */
async function testEndpoint(endpoint) {
  return deliverToEndpoint(endpoint, {
    event: 'ping',
    deliveryId: crypto.randomUUID(),
    timestamp: Date.now(),
    data: { message: 'BCK webhook test' },
  });
}

module.exports = { emit, testEndpoint, EVENT_TYPES };
