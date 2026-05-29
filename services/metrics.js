const client = require('prom-client');

// Create a Registry
const register = new client.Registry();

// Default metrics (Node.js process: memory, CPU, event loop lag, etc.)
client.collectDefaultMetrics({ register, prefix: 'bck_' });

// ─── Custom Counters & Gauges ────────────────────────────────────────────────

const backupsTotal = new client.Counter({
  name: 'bck_backups_total',
  help: 'Total number of backups by status',
  labelNames: ['status', 'type'],
  registers: [register],
});

const backupDurationSeconds = new client.Histogram({
  name: 'bck_backup_duration_seconds',
  help: 'Backup execution duration in seconds',
  labelNames: ['type'],
  buckets: [10, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [register],
});

const backupSizeBytesTotal = new client.Counter({
  name: 'bck_backup_size_bytes_total',
  help: 'Total bytes backed up',
  labelNames: ['type'],
  registers: [register],
});

const activeSchedules = new client.Gauge({
  name: 'bck_active_schedules',
  help: 'Number of active cron schedules',
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'bck_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'bck_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const diskFreeBytes = new client.Gauge({
  name: 'bck_disk_free_bytes',
  help: 'Free disk space in bytes',
  registers: [register],
});

const diskTotalBytes = new client.Gauge({
  name: 'bck_disk_total_bytes',
  help: 'Total disk space in bytes',
  registers: [register],
});

const connectedUsers = new client.Gauge({
  name: 'bck_connected_websocket_clients',
  help: 'Number of connected WebSocket clients',
  registers: [register],
});

// ─── Express Middleware ──────────────────────────────────────────────────────

function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => {
    httpRequestsTotal.inc({ method: req.method, route: req.path, status_code: res.statusCode });
    end();
  });
  next();
}

// ─── Update Gauges from DB ───────────────────────────────────────────────────

function refreshMetrics(db, getDiskStats, backupDir) {
  try {
    const sched = db.prepare('SELECT COUNT(*) as cnt FROM schedules WHERE enabled = 1').get();
    activeSchedules.set(sched.cnt || 0);
  } catch (e) {}

  try {
    const disk = getDiskStats(backupDir || '.');
    diskFreeBytes.set(disk.free || 0);
    diskTotalBytes.set(disk.total || 0);
  } catch (e) {}
}

module.exports = {
  register,
  metricsMiddleware,
  refreshMetrics,
  counters: {
    backupsTotal,
    backupDurationSeconds,
    backupSizeBytesTotal,
    connectedUsers,
  },
};
