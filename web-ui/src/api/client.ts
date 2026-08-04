import axios from 'axios'

const TOKEN_KEY = 'bck_token'
const USER_KEY = 'bck_user'

export const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

export function saveAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export interface AuthUser {
  id: string
  username: string
  role: string
}

export interface DashboardStats {
  total_jobs: number
  active_jobs: number
  completed_jobs: number
  failed_jobs: number
  total_repositories: number
  total_snapshots: number
  storage_used_bytes: number
  storage_free_bytes: number
}

export interface Job {
  id: string
  name: string
  description?: string | null
  job_type: string
  backup_type: string
  source_path: string
  repository_id: string
  schedule?: string | null
  enabled: boolean
  status: string
  progress: number
  started_at?: number | null
  finished_at?: number | null
  created_at: number
  last_run_at?: number | null
}

export interface Repository {
  id: string
  name: string
  repo_type: string
  capacity_bytes: number
  used_bytes: number
  free_bytes: number
  encrypted: boolean
  status: string
  created_at: number
}

export interface Snapshot {
  id: string
  job_id: string
  repository_id: string
  snapshot_type: string
  parent_id?: string | null
  size_bytes: number
  unique_bytes: number
  compressed_bytes: number
  checksum: string
  consistency: string
  app_consistent: boolean
  created_at: number
}

export interface Agent {
  id: string
  hostname: string
  ip_address?: string | null
  os_type?: string | null
  os_version?: string | null
  agent_version?: string | null
  status: string
  last_seen?: number | null
  capabilities: string
  created_at: number
}

export interface EventInfo {
  id: number
  event_type: string
  source: string
  message: string
  job_id?: string | null
  session_id?: string | null
  created_at: number
}

export interface CreateJobPayload {
  name: string
  description?: string
  job_type?: string
  backup_type?: string
  source_path: string
  repository_id: string
  schedule?: string
  retention_days?: number
}

export interface CreateRepoPayload {
  name: string
  repo_type: string
  path?: string
  bucket?: string
  region?: string
  endpoint?: string
  access_key?: string
  secret_key?: string
  container?: string
  account?: string
}

export interface FileRestorePayload {
  snapshot_id: string
  files: string[]
  target_path: string
  overwrite?: boolean
}

// API helpers
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string; user: AuthUser }>('/auth/login', { username, password }),
  me: () => api.get<AuthUser>('/auth/me'),
}

export const dashboardApi = {
  stats: () => api.get<DashboardStats>('/dashboard/stats'),
}

export const jobsApi = {
  list: () => api.get<Job[]>('/jobs'),
  get: (id: string) => api.get<Job>(`/jobs/${id}`),
  create: (payload: CreateJobPayload) => api.post<Job>('/jobs', payload),
  update: (id: string, payload: Partial<{ name: string; schedule: string; enabled: boolean }>) =>
    api.put<Job>(`/jobs/${id}`, payload),
  remove: (id: string) => api.delete(`/jobs/${id}`),
  run: (id: string) => api.post(`/jobs/${id}/run`),
  cancel: (id: string) => api.post(`/jobs/${id}/cancel`),
}

export const reposApi = {
  list: () => api.get<Repository[]>('/repositories'),
  create: (payload: CreateRepoPayload) => api.post<Repository>('/repositories', payload),
  remove: (id: string) => api.delete(`/repositories/${id}`),
}

export const snapshotsApi = {
  list: (params?: { job_id?: string; limit?: number }) =>
    api.get<Snapshot[]>('/snapshots', { params }),
  remove: (id: string) => api.delete(`/snapshots/${id}`),
}

export const restoreApi = {
  file: (payload: FileRestorePayload) => api.post('/restore/file', payload),
  explore: (snapshotId: string) => api.get(`/restore/explore/${snapshotId}`),
  session: (id: string) => api.get(`/restore/session/${id}`),
}

export const agentsApi = {
  list: () => api.get<Agent[]>('/agents'),
  remove: (id: string) => api.delete(`/agents/${id}`),
}

export const eventsApi = {
  list: (limit = 50) => api.get<EventInfo[]>('/events', { params: { limit } }),
}
