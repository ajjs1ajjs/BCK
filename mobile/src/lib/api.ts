const API_BASE = "http://localhost:8050/api/v1";

let accessToken: string | null = null;

export async function login(username: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.access_token;
    return true;
  } catch {
    return false;
  }
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

export const api = {
  getStats: () => apiFetch("/stats").then((r) => r.json()),
  listJobs: () => apiFetch("/jobs").then((r) => r.json()),
  getJob: (id: string) => apiFetch(`/jobs/${id}`).then((r) => r.json()),
  listJobRuns: (id: string) => apiFetch(`/jobs/${id}/runs`).then((r) => r.json()),
  runJob: (id: string) => apiFetch(`/jobs/${id}/run`, { method: "POST" }),
  listSnapshots: () => apiFetch("/snapshots").then((r) => r.json()),
  health: () => apiFetch("/health").then((r) => r.json()),
};
