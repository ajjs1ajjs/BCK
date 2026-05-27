const API = process.env.REACT_APP_API_URL || '';

export function getToken() {
  try {
    const saved = localStorage.getItem('bck-auth');
    if (saved) return JSON.parse(saved).token || null;
  } catch (_) { /* ignore */ }
  return null;
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!headers['Content-Type'] && options.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${path}`, { ...options, headers });
  if (r.status === 401) {
    localStorage.removeItem('bck-auth');
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  return r;
}

// Patch global fetch to auto-inject JWT token
const originalFetch = window.fetch;
window.fetch = async (input, options = {}) => {
  const url = typeof input === 'string' ? input : input.url || '';
  if (url.startsWith('/api/') || url.startsWith(API + '/api/')) {
    const token = getToken();
    if (token) {
      options.headers = options.headers || {};
      if (Array.isArray(options.headers)) {
        options.headers.push(['Authorization', `Bearer ${token}`]);
      } else {
        options.headers = new Headers(options.headers);
        if (!options.headers.has('Authorization')) {
          options.headers.set('Authorization', `Bearer ${token}`);
        }
      }
    }
  }
  const r = await originalFetch(input, options);
  if (r.status === 401 && !url.endsWith('/api/login')) {
    localStorage.removeItem('bck-auth');
    window.location.href = '/login';
  }
  return r;
};
