import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  IconButton, Tooltip, LinearProgress, Stack, Typography, Alert, Chip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import EmailIcon from '@mui/icons-material/Email'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, formatTs, prettyStatus } from '../utils'
import { m365Api, type M365Tenant, type M365BackupJob } from '../api/client'

const BACKUP_TYPES = ['Mailbox', 'OneDrive', 'SharePoint', 'All']

const EMPTY_TENANT = {
  name: '',
  tenant_id: '',
  auth_type: 'AppOnly',
  client_id: '',
  encrypted_secret: '',
  status: 'Connected',
}

export default function M365() {
  const [tenants, setTenants] = useState<M365Tenant[]>([])
  const [jobs, setJobs] = useState<M365BackupJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [tenantDialog, setTenantDialog] = useState(false)
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT)
  const [backupDialog, setBackupDialog] = useState<M365Tenant | null>(null)
  const [backupType, setBackupType] = useState('Mailbox')

  const load = useCallback(async () => {
    try {
      const [t, j] = await Promise.all([m365Api.tenants(), m365Api.jobs()])
      setTenants(t.data)
      setJobs(j.data)
    } catch {
      setError('Failed to load Microsoft 365 data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const registerTenant = async () => {
    if (!tenantForm.name || !tenantForm.tenant_id) return
    setBusy(true)
    setError(null)
    try {
      await m365Api.registerTenant({
        ...tenantForm,
        auth_type: tenantForm.auth_type as M365Tenant['auth_type'],
      })
      setTenantDialog(false)
      setTenantForm(EMPTY_TENANT)
      load()
    } catch {
      setError('Failed to register M365 tenant')
    } finally {
      setBusy(false)
    }
  }

  const startBackup = async () => {
    if (!backupDialog) return
    setBusy(true)
    setError(null)
    try {
      await m365Api.startBackup(backupDialog.id!, backupType)
      setBackupDialog(null)
      load()
    } catch {
      setError('Failed to start M365 backup')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      <PageHeader
        title="Microsoft 365"
        subtitle="Mailbox, OneDrive and SharePoint backup"
        actions={<Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <LinearProgress />
      ) : (
        <>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <EmailIcon color="primary" />
                <Typography variant="h6">Tenants</Typography>
                <Chip label={`${tenants.length} tenants`} size="small" />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setTenantDialog(true)}>
                  Register Tenant
                </Button>
              </Stack>
              {tenants.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No tenants registered
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Tenant ID</TableCell>
                      <TableCell>Auth</TableCell>
                      <TableCell>Client ID</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tenants.map((t) => (
                      <TableRow key={t.id} hover>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography></TableCell>
                        <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{t.tenant_id}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{t.auth_type}</Typography></TableCell>
                        <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{t.client_id}</Typography></TableCell>
                        <TableCell><StatusChip status={t.status} /></TableCell>
                        <TableCell align="right">
                          <Tooltip title="Start backup">
                            <IconButton size="small" color="primary" onClick={() => { setBackupType('Mailbox'); setBackupDialog(t) }}>
                              <PlayArrowIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <EmailIcon color="secondary" />
                <Typography variant="h6">Backup Jobs</Typography>
                <Chip label={jobs.length} size="small" />
              </Stack>
              {jobs.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No backup jobs have run yet
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Type</TableCell>
                      <TableCell>Tenant</TableCell>
                      <TableCell>Items</TableCell>
                      <TableCell>Data</TableCell>
                      <TableCell>Started</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {jobs.map((j) => (
                      <TableRow key={j.id} hover>
                        <TableCell><Typography variant="body2">{prettyStatus(j.backup_type)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{tenants.find((t) => t.id === j.tenant_id)?.name ?? j.tenant_id.slice(0, 8)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{j.items_processed}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{formatBytes(j.bytes_processed)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{formatTs(j.started_at)}</Typography></TableCell>
                        <TableCell><StatusChip status={j.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={tenantDialog} onClose={() => setTenantDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Register M365 Tenant</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Display name" value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} fullWidth required />
            <TextField label="Azure AD tenant id" value={tenantForm.tenant_id} onChange={(e) => setTenantForm({ ...tenantForm, tenant_id: e.target.value })} fullWidth required />
            <TextField
              select label="Auth type" value={tenantForm.auth_type}
              onChange={(e) => setTenantForm({ ...tenantForm, auth_type: e.target.value })}
              fullWidth
            >
              <MenuItem value="AppOnly">App-only</MenuItem>
              <MenuItem value="Delegated">Delegated</MenuItem>
            </TextField>
            <TextField label="Client (app) id" value={tenantForm.client_id} onChange={(e) => setTenantForm({ ...tenantForm, client_id: e.target.value })} fullWidth />
            <TextField label="Client secret" type="password" value={tenantForm.encrypted_secret} onChange={(e) => setTenantForm({ ...tenantForm, encrypted_secret: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTenantDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={registerTenant}>Register</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={backupDialog != null} onClose={() => setBackupDialog(null)}>
        <DialogTitle>Start backup</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1, minWidth: 320 }}>
            <Typography variant="body2">Tenant: <strong>{backupDialog?.name}</strong></Typography>
            <TextField
              select label="Backup type" value={backupType}
              onChange={(e) => setBackupType(e.target.value)}
              fullWidth
            >
              {BACKUP_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBackupDialog(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={startBackup}>Start</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
