import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  IconButton, Tooltip, LinearProgress, Stack, Typography, Alert, Chip,
  Switch, FormControlLabel,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteIcon from '@mui/icons-material/Delete'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import BlockIcon from '@mui/icons-material/Block'
import SettingsIcon from '@mui/icons-material/Settings'
import GroupsIcon from '@mui/icons-material/Groups'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatTs } from '../utils'
import { tenantsApi, type Tenant, type TenantQuota, type TenantSettings } from '../api/client'

const EMPTY_QUOTA: TenantQuota = {
  max_repositories: 5,
  max_vms: 50,
  max_users: 10,
  max_storage_gb: 1024,
  max_retention_days: 90,
  max_snapshots_per_vm: 30,
  allow_cloud_tiers: false,
  allow_tape: false,
}

interface SettingsForm {
  default_retention_days: number
  backup_window_start: string
  backup_window_end: string
  notify_on_failure: boolean
  notify_on_success: boolean
  allowed_hypervisors: string
  allowed_storage: string
}

const EMPTY_SETTINGS: SettingsForm = {
  default_retention_days: 30,
  backup_window_start: '22:00',
  backup_window_end: '06:00',
  notify_on_failure: true,
  notify_on_success: false,
  allowed_hypervisors: 'vmware, hyperv',
  allowed_storage: 'local, s3',
}

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [createDialog, setCreateDialog] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', slug: '' })

  const [editTenant, setEditTenant] = useState<Tenant | null>(null)
  const [editTab, setEditTab] = useState<'quota' | 'settings'>('quota')
  const [editQuota, setEditQuota] = useState<TenantQuota>(EMPTY_QUOTA)
  const [editSettings, setEditSettings] = useState(EMPTY_SETTINGS)

  const [confirmDelete, setConfirmDelete] = useState<Tenant | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await tenantsApi.list()
      setTenants(r.data)
    } catch {
      setError('Failed to load tenants')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!createForm.name || !createForm.slug) return
    setBusy(true)
    setError(null)
    try {
      await tenantsApi.create(createForm.name, createForm.slug)
      setCreateDialog(false)
      setCreateForm({ name: '', slug: '' })
      load()
    } catch {
      setError('Failed to create tenant')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (id: string, action: 'suspend' | 'activate' | 'disable') => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'suspend') await tenantsApi.suspend(id)
      else if (action === 'activate') await tenantsApi.activate(id)
      else await tenantsApi.disable(id)
      load()
    } catch {
      setError(`Failed to ${action} tenant`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirmDelete) return
    setBusy(true)
    setError(null)
    try {
      await tenantsApi.remove(confirmDelete.id)
      setConfirmDelete(null)
      load()
    } catch {
      setError('Failed to delete tenant')
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (t: Tenant) => {
    setEditTenant(t)
    setEditTab('quota')
    setEditQuota(t.quota)
    setEditSettings({
      default_retention_days: t.settings.default_retention_days,
      backup_window_start: t.settings.backup_window_start,
      backup_window_end: t.settings.backup_window_end,
      notify_on_failure: t.settings.notify_on_failure,
      notify_on_success: t.settings.notify_on_success,
      allowed_hypervisors: t.settings.allowed_hypervisors.join(', '),
      allowed_storage: t.settings.allowed_storage.join(', '),
    })
  }

  const saveEdit = async () => {
    if (!editTenant) return
    setBusy(true)
    setError(null)
    try {
      if (editTab === 'quota') {
        await tenantsApi.updateQuota(editTenant.id, editQuota)
      } else {
        await tenantsApi.updateSettings(editTenant.id, {
          default_retention_days: editSettings.default_retention_days,
          backup_window_start: editSettings.backup_window_start,
          backup_window_end: editSettings.backup_window_end,
          notify_on_failure: editSettings.notify_on_failure,
          notify_on_success: editSettings.notify_on_success,
          allowed_hypervisors: editSettings.allowed_hypervisors.split(',').map((s) => s.trim()).filter(Boolean),
          allowed_storage: editSettings.allowed_storage.split(',').map((s) => s.trim()).filter(Boolean),
        })
      }
      setEditTenant(null)
      load()
    } catch {
      setError('Failed to update tenant')
    } finally {
      setBusy(false)
    }
  }

  const quotaPct = (t: Tenant) => {
    const total = t.quota.max_repositories + t.quota.max_vms + t.quota.max_users
    const used = t.usage.repositories + t.usage.vms + t.usage.users
    return total > 0 ? Math.round((used / total) * 100) : 0
  }

  return (
    <Box>
      <PageHeader
        title="Multi-tenancy"
        subtitle="Tenant isolation, resource quotas and per-tenant settings"
        actions={
          <>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateDialog(true)}>New Tenant</Button>
          </>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        <CardContent>
          {loading ? (
            <LinearProgress />
          ) : tenants.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <GroupsIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography color="text.secondary" gutterBottom>No tenants configured</Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateDialog(true)}>Create your first tenant</Button>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Slug</TableCell>
                  <TableCell sx={{ width: 160 }}>Quota usage</TableCell>
                  <TableCell>Storage</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tenants.map((t) => {
                  const pct = quotaPct(t)
                  return (
                    <TableRow key={t.id} hover>
                      <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography></TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{t.slug}</Typography></TableCell>
                      <TableCell>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Box sx={{ width: 90, bgcolor: '#EDF0F5', borderRadius: 1, height: 6 }}>
                            <Box sx={{ width: `${pct}%`, bgcolor: pct > 90 ? '#E53935' : '#1E88E5', height: 6, borderRadius: 1 }} />
                          </Box>
                          <Typography variant="caption" color="text.secondary">{pct}%</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{t.usage.storage_used_gb} / {t.quota.max_storage_gb} GB</Typography>
                      </TableCell>
                      <TableCell><Typography variant="body2">{formatTs(t.created_at)}</Typography></TableCell>
                      <TableCell><StatusChip status={t.status} /></TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Tooltip title="Edit quota / settings">
                            <IconButton size="small" onClick={() => openEdit(t)}>
                              <SettingsIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          {t.status === 'Active' && (
                            <Tooltip title="Suspend">
                              <IconButton size="small" color="warning" disabled={busy} onClick={() => setStatus(t.id, 'suspend')}>
                                <PauseIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {t.status !== 'Active' && (
                            <Tooltip title="Activate">
                              <IconButton size="small" color="success" disabled={busy} onClick={() => setStatus(t.id, 'activate')}>
                                <PlayArrowIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {t.status !== 'Disabled' && (
                            <Tooltip title="Disable">
                              <IconButton size="small" color="default" disabled={busy} onClick={() => setStatus(t.id, 'disable')}>
                                <BlockIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Delete tenant">
                            <IconButton size="small" color="error" onClick={() => setConfirmDelete(t)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createDialog} onClose={() => setCreateDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New Tenant</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Tenant name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} fullWidth required />
            <TextField label="Slug" value={createForm.slug} onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })} fullWidth required placeholder="acme" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={create}>Create</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editTenant != null} onClose={() => setEditTenant(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Configure {editTenant?.name}</DialogTitle>
        <DialogContent>
          <Stack direction="row" spacing={1} sx={{ mb: 2, mt: 1 }}>
            <Button size="small" variant={editTab === 'quota' ? 'contained' : 'outlined'} onClick={() => setEditTab('quota')}>Quota</Button>
            <Button size="small" variant={editTab === 'settings' ? 'contained' : 'outlined'} onClick={() => setEditTab('settings')}>Settings</Button>
          </Stack>
          {editTab === 'quota' ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2}>
                <TextField label="Max repositories" type="number" value={editQuota.max_repositories}
                  onChange={(e) => setEditQuota({ ...editQuota, max_repositories: Number(e.target.value) })} fullWidth />
                <TextField label="Max VMs" type="number" value={editQuota.max_vms}
                  onChange={(e) => setEditQuota({ ...editQuota, max_vms: Number(e.target.value) })} fullWidth />
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField label="Max users" type="number" value={editQuota.max_users}
                  onChange={(e) => setEditQuota({ ...editQuota, max_users: Number(e.target.value) })} fullWidth />
                <TextField label="Max storage (GB)" type="number" value={editQuota.max_storage_gb}
                  onChange={(e) => setEditQuota({ ...editQuota, max_storage_gb: Number(e.target.value) })} fullWidth />
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField label="Max retention (days)" type="number" value={editQuota.max_retention_days}
                  onChange={(e) => setEditQuota({ ...editQuota, max_retention_days: Number(e.target.value) })} fullWidth />
                <TextField label="Max snapshots per VM" type="number" value={editQuota.max_snapshots_per_vm}
                  onChange={(e) => setEditQuota({ ...editQuota, max_snapshots_per_vm: Number(e.target.value) })} fullWidth />
              </Stack>
              <FormControlLabel
                control={<Switch checked={editQuota.allow_cloud_tiers} onChange={(e) => setEditQuota({ ...editQuota, allow_cloud_tiers: e.target.checked })} />}
                label="Allow cloud tiers"
              />
              <FormControlLabel
                control={<Switch checked={editQuota.allow_tape} onChange={(e) => setEditQuota({ ...editQuota, allow_tape: e.target.checked })} />}
                label="Allow tape"
              />
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2}>
                <TextField label="Default retention (days)" type="number" value={editSettings.default_retention_days}
                  onChange={(e) => setEditSettings({ ...editSettings, default_retention_days: Number(e.target.value) })} fullWidth />
                <TextField label="Backup window start" value={editSettings.backup_window_start}
                  onChange={(e) => setEditSettings({ ...editSettings, backup_window_start: e.target.value })} fullWidth />
                <TextField label="Backup window end" value={editSettings.backup_window_end}
                  onChange={(e) => setEditSettings({ ...editSettings, backup_window_end: e.target.value })} fullWidth />
              </Stack>
              <TextField label="Allowed hypervisors (comma-separated)" value={editSettings.allowed_hypervisors}
                onChange={(e) => setEditSettings({ ...editSettings, allowed_hypervisors: e.target.value })} fullWidth />
              <TextField label="Allowed storage (comma-separated)" value={editSettings.allowed_storage}
                onChange={(e) => setEditSettings({ ...editSettings, allowed_storage: e.target.value })} fullWidth />
              <FormControlLabel
                control={<Switch checked={editSettings.notify_on_failure} onChange={(e) => setEditSettings({ ...editSettings, notify_on_failure: e.target.checked })} />}
                label="Notify on failure"
              />
              <FormControlLabel
                control={<Switch checked={editSettings.notify_on_success} onChange={(e) => setEditSettings({ ...editSettings, notify_on_success: e.target.checked })} />}
                label="Notify on success"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditTenant(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={saveEdit}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete != null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete tenant?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Delete tenant &ldquo;{confirmDelete?.name}&rdquo;? This removes the tenant configuration and its isolation.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={remove}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
