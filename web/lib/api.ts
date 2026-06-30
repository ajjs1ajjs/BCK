const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8050/api/v1";

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  if (typeof window !== "undefined") {
    localStorage.setItem("access_token", access);
    localStorage.setItem("refresh_token", refresh);
  }
}

export function loadTokens() {
  if (typeof window !== "undefined") {
    accessToken = localStorage.getItem("access_token");
    refreshToken = localStorage.getItem("refresh_token");
  }
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  }
}

export function getAccessToken() {
  return accessToken;
}

export async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token ?? refreshToken!);
    return true;
  } catch {
    return false;
  }
}

async function apiFetch(path: string, options: RequestInit = {}) {
  loadTokens();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && refreshToken) {
    const ok = await refreshAccessToken();
    if (ok) {
      headers["Authorization"] = `Bearer ${accessToken}`;
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  return res;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  me: () => apiFetch("/auth/me"),

  // Jobs
  listJobs: () => apiFetch("/jobs"),
  getJob: (id: string) => apiFetch(`/jobs/${id}`),
  createJob: (data: any) =>
    apiFetch("/jobs", { method: "POST", body: JSON.stringify(data) }),
  updateJob: (id: string, data: any) =>
    apiFetch(`/jobs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteJob: (id: string) =>
    apiFetch(`/jobs/${id}`, { method: "DELETE" }),
  runJob: (id: string) =>
    apiFetch(`/jobs/${id}/run`, { method: "POST" }),
  listJobRuns: (id: string) => apiFetch(`/jobs/${id}/runs`),

  // Repositories
  listRepos: () => apiFetch("/repositories"),
  getRepo: (id: string) => apiFetch(`/repositories/${id}`),
  createRepo: (data: any) =>
    apiFetch("/repositories", { method: "POST", body: JSON.stringify(data) }),
  updateRepo: (id: string, data: any) =>
    apiFetch(`/repositories/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteRepo: (id: string) =>
    apiFetch(`/repositories/${id}`, { method: "DELETE" }),

  // Snapshots
  listSnapshots: (repoId?: string) =>
    apiFetch(`/snapshots${repoId ? `?repository_id=${repoId}` : ""}`),

  // Restore
  startRestore: (data: any) =>
    apiFetch("/restore", { method: "POST", body: JSON.stringify(data) }),
  getRestoreStatus: (id: string) => apiFetch(`/restore/${id}`),

  // Stats
  getStats: () => apiFetch("/stats"),

  // Agents
  listAgents: () => apiFetch("/agents"),
  getAgent: (id: string) => apiFetch(`/agents/${id}`),
  registerAgent: (data: any) => apiFetch("/agents", { method: "POST", body: JSON.stringify(data) }),
  updateAgent: (id: string, data: any) => apiFetch(`/agents/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAgent: (id: string) => apiFetch(`/agents/${id}`, { method: "DELETE" }),
};
