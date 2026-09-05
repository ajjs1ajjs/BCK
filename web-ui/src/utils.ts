export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—'
  const n = Math.max(0, Number(bytes))
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  const val = n / Math.pow(1024, i)
  return `${val.toFixed(val >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatTs(ts?: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export function formatRelative(ts?: number | null): string {
  if (!ts) return 'never'
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function statusTone(status: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  const s = (status || '').toLowerCase()
  if (s.includes('complet') || s.includes('success') || s === 'online' || s === 'ok' || s === 'healthy') return 'success'
  if (s.includes('fail') || s.includes('error') || s === 'offline' || s === 'critical') return 'error'
  if (s.includes('warn') || s.includes('paused') || s.includes('degrad')) return 'warning'
  if (s.includes('run') || s.includes('progress') || s.includes('pending') || s.includes('queued')) return 'info'
  return 'default'
}

export function prettyStatus(status: string): string {
  if (!status) return 'Unknown'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
