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

// Phase 4–5 entities

export interface StorageTier {
  id?: string
  name: string
  tier_type: 'Performance' | 'Capacity' | 'Archive'
  backend: string
  backend_config: Record<string, unknown>
  capacity_bytes: number
  used_bytes: number
  status: string
  priority: number
}

export interface SobrPolicy {
  id?: string
  name: string
  performance_tier_id: string
  capacity_tier_id: string
  archive_tier_id?: string | null
  capacity_move_days: number
  archive_move_days?: number | null
  seal_days?: number | null
  retention_days?: number | null
}

export interface CloudAccount {
  id?: string
  name: string
  provider: 'Aws' | 'Azure' | 'Gcp'
  auth_type: string
  region: string
  status: string
  access_key?: string | null
  secret_key?: string | null
  session_token?: string | null
  tenant_id?: string | null
  client_id?: string | null
  client_secret?: string | null
  project_id?: string | null
}

export interface M365Tenant {
  id?: string
  tenant_id: string
  name: string
  auth_type: 'AppOnly' | 'Delegated'
  client_id: string
  encrypted_secret: string
  status: string
}

export interface M365BackupJob {
  id: string
  tenant_id: string
  backup_type: string
  status: string
  items_processed: number
  bytes_processed: number
  started_at: number
  completed_at?: number | null
}

export interface TapeDrive {
  id?: string
  name: string
  device_path: string
  drive_type: string
  loaded_media?: string | null
  status: string
  capacity_bytes: number
  used_bytes: number
}

export interface TapeMedia {
  id?: string
  barcode: string
  capacity_bytes: number
  used_bytes: number
  media_type: string
  status: string
  last_written?: number | null
  retention_until?: number | null
  location: string
}

export interface CdpPolicy {
  id?: string
  name: string
  paths: string[]
  rpo_seconds: number
  min_interval_seconds: number
  retention_days: number
  compression: string
  encryption: boolean
  exclude_patterns: string[]
}

export interface CdpSession {
  id: string
  policy_id: string
  status: string
  changes_tracked: number
  bytes_protected: number
  last_checkpoint?: number | null
  started_at: number
}

export interface CdpStats {
  active_policies: number
  total_changes: number
  total_bytes: number
}

export interface DrSite {
  id?: string
  name: string
  dr_type: string
  endpoint: string
  credentials_id: string
  storage_id: string
  is_primary: boolean
  status: string
}

export interface DrPlan {
  id?: string
  name: string
  source_site: string
  target_site: string
  vms: string[]
  replication_policy: {
    rpo_seconds: number
    rto_seconds: number
    compression: string
    encryption: boolean
    bandwidth_throttle_mbps: number
  }
  failover_order: string[]
  auto_commit: boolean
  test_mode: boolean
}

export interface SsoProvider {
  id: string
  name: string
  provider_type: string
  issuer_url: string
  client_id: string
  encrypted_client_secret: string
  scopes: string[]
  auto_provision: boolean
  default_role: string
  enabled: boolean
}

export interface LdapConfig {
  url: string
  bind_dn: string
  bind_password: string
  base_dn: string
  user_filter: string
  group_filter: string
  tls: boolean
}

export interface ExecuteResult {
  policy_id?: string
  plan_id?: string
  moved_bytes?: number
  result?: string
}

export interface Tenant {
  id: string
  name: string
  slug: string
  status: 'Active' | 'Suspended' | 'Disabled'
  quota: TenantQuota
  usage: ResourceUsage
  settings: TenantSettings
  created_at: number
}

export interface TenantQuota {
  max_repositories: number
  max_vms: number
  max_users: number
  max_storage_gb: number
  max_retention_days: number
  max_snapshots_per_vm: number
  allow_cloud_tiers: boolean
  allow_tape: boolean
}

export interface ResourceUsage {
  repositories: number
  vms: number
  users: number
  storage_used_gb: number
  snapshots_total: number
  monthly_data_written_gb: number
}

export interface TenantSettings {
  default_retention_days: number
  backup_window_start: string
  backup_window_end: string
  notify_on_failure: boolean
  notify_on_success: boolean
  allowed_hypervisors: string[]
  allowed_storage: string[]
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

export const sobrApi = {
  tiers: () => api.get<StorageTier[]>('/sobr'),
  addTier: (payload: StorageTier) => api.post<StorageTier>('/sobr/tiers', payload),
  policies: () => api.get<SobrPolicy[]>('/sobr/policies'),
  createPolicy: (payload: SobrPolicy) => api.post<SobrPolicy>('/sobr/policies', payload),
  execute: (id: string) => api.post<ExecuteResult>(`/sobr/policies/${id}/execute`),
}

export const cloudApi = {
  list: () => api.get<CloudAccount[]>('/cloud'),
  get: (id: string) => api.get<CloudAccount>(`/cloud/${id}`),
  register: (payload: CloudAccount) => api.post<CloudAccount>('/cloud', payload),
  remove: (id: string) => api.delete(`/cloud/${id}`),
}

export const m365Api = {
  tenants: () => api.get<M365Tenant[]>('/m365/tenants'),
  registerTenant: (payload: M365Tenant) => api.post<M365Tenant>('/m365/tenants', payload),
  jobs: () => api.get<M365BackupJob[]>('/m365/jobs'),
  startBackup: (tenantId: string, backupType: string) =>
    api.post<M365BackupJob>('/m365/jobs', { tenant_id: tenantId, backup_type: backupType }),
}

export const tapeApi = {
  drives: () => api.get<TapeDrive[]>('/tape/drives'),
  registerDrive: (payload: TapeDrive) => api.post<TapeDrive>('/tape/drives', payload),
  media: () => api.get<TapeMedia[]>('/tape/media'),
  addMedia: (payload: TapeMedia) => api.post<TapeMedia>('/tape/media', payload),
  formatMedia: (payload: { device_path: string; barcode: string; capacity_bytes: number }) =>
    api.post<TapeMedia>('/tape/media/format', payload),
  loadMedia: (driveId: string, mediaId: string) =>
    api.post(`/tape/drives/${driveId}/load`, { media_id: mediaId }),
  ejectMedia: (driveId: string) => api.post(`/tape/drives/${driveId}/eject`),
  write: (driveId: string, name: string, data: Uint8Array) =>
    api.post<{ name: string; bytes_written: number }>(`/tape/drives/${driveId}/write`, {
      name,
      data_base64: bytesToBase64(data),
    }),
  read: (driveId: string, name: string) =>
    api.get<{ name: string; data_base64: string }>(`/tape/drives/${driveId}/read`, { params: { name } }),
  applyRetention: () => api.post<{ media_released: number }>('/tape/retention'),
}

export const cdpApi = {
  policies: () => api.get<CdpPolicy[]>('/cdp/policies'),
  createPolicy: (payload: CdpPolicy) => api.post<CdpPolicy>('/cdp/policies', payload),
  start: (id: string) => api.post<CdpSession>(`/cdp/policies/${id}/start`),
  sessions: () => api.get<CdpSession[]>('/cdp/sessions'),
  stop: (id: string) => api.post(`/cdp/sessions/${id}/stop`),
  stats: () => api.get<CdpStats>('/cdp/stats'),
}

export const drApi = {
  status: () => api.get<string>('/dr/status'),
  sites: () => api.get<DrSite[]>('/dr/sites'),
  registerSite: (payload: DrSite) => api.post<DrSite>('/dr/sites', payload),
  plans: () => api.get<DrPlan[]>('/dr/plans'),
  createPlan: (payload: DrPlan) => api.post<DrPlan>('/dr/plans', payload),
  failover: (id: string) => api.post<ExecuteResult>(`/dr/plans/${id}/failover`),
  failback: (id: string) => api.post<ExecuteResult>(`/dr/plans/${id}/failback`),
  test: (id: string) => api.post<ExecuteResult>(`/dr/plans/${id}/test`),
}

export const ssoApi = {
  providers: () => api.get<SsoProvider[]>('/auth/sso/providers'),
  registerProvider: (payload: SsoProvider) => api.post<SsoProvider>('/auth/sso/providers', payload),
  addLdap: (payload: LdapConfig) => api.post('/auth/sso/ldap', payload),
}

export const tenantsApi = {
  list: () => api.get<Tenant[]>('/tenants'),
  get: (id: string) => api.get<Tenant>(`/tenants/${id}`),
  create: (name: string, slug: string) => api.post<Tenant>('/tenants', { name, slug }),
  remove: (id: string) => api.delete(`/tenants/${id}`),
  suspend: (id: string) => api.post(`/tenants/${id}/suspend`),
  activate: (id: string) => api.post(`/tenants/${id}/activate`),
  disable: (id: string) => api.post(`/tenants/${id}/disable`),
  updateQuota: (id: string, quota: TenantQuota) => api.put<Tenant>(`/tenants/${id}/quota`, quota),
  updateSettings: (id: string, settings: TenantSettings) => api.put<Tenant>(`/tenants/${id}/settings`, settings),
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
