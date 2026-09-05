import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  IconButton, Tooltip, LinearProgress, Stack, Typography, Alert, Chip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import SwitchAccountIcon from '@mui/icons-material/SwitchAccount'
import ScienceIcon from '@mui/icons-material/Science'
import UndoIcon from '@mui/icons-material/Undo'
import PublicIcon from '@mui/icons-material/Public'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { prettyStatus } from '../utils'
import { drApi, type DrSite, type DrPlan } from '../api/client'

const SITE_TYPES = ['Vmware', 'HyperV', 'CloudAws', 'CloudAzure', 'RemoteBck']

const EMPTY_SITE = {
  name: '',
  dr_type: 'Vmware',
  endpoint: '',
  credentials_id: '',
  storage_id: '',
  is_primary: false,
  status: 'Online',
}

const EMPTY_PLAN = {
  name: '',
  source_site: '',
  target_site: '',
  vms: '',
  failover_order: '',
  auto_commit: true,
  test_mode: true,
  replication_policy: {
    rpo_seconds: 900,
    rto_seconds: 3600,
    compression: 'zstd',
    encryption: true,
    bandwidth_throttle_mbps: 1000,
  },
}

export default function Dr() {
  const [status, setStatus] = useState<string>('Idle')
  const [sites, setSites] = useState<DrSite[]>([])
  const [plans, setPlans] = useState<DrPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [siteDialog, setSiteDialog] = useState(false)
  const [siteForm, setSiteForm] = useState(EMPTY_SITE)
  const [planDialog, setPlanDialog] = useState(false)
  const [planForm, setPlanForm] = useState(EMPTY_PLAN)

  const load = useCallback(async () => {
    try {
      const [s, sitesR, p] = await Promise.all([drApi.status(), drApi.sites(), drApi.plans()])
      setStatus(s.data)
      setSites(sitesR.data)
      setPlans(p.data)
    } catch {
      setError('Failed to load DR configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const registerSite = async () => {
    if (!siteForm.name) return
    setBusy(true)
    setError(null)
    try {
      await drApi.registerSite(siteForm)
      setSiteDialog(false)
      setSiteForm(EMPTY_SITE)
      load()
    } catch {
      setError('Failed to register DR site')
    } finally {
      setBusy(false)
    }
  }

  const createPlan = async () => {
    if (!planForm.name) return
    setBusy(true)
    setError(null)
    try {
      await drApi.createPlan({
        name: planForm.name,
        source_site: planForm.source_site,
        target_site: planForm.target_site,
        vms: planForm.vms.split(',').map((s) => s.trim()).filter(Boolean),
        failover_order: planForm.failover_order.split(',').map((s) => s.trim()).filter(Boolean),
        auto_commit: planForm.auto_commit,
        test_mode: planForm.test_mode,
        replication_policy: planForm.replication_policy,
      })
      setPlanDialog(false)
      setPlanForm(EMPTY_PLAN)
      load()
    } catch {
      setError('Failed to create DR plan')
    } finally {
      setBusy(false)
    }
  }

  const action = async (id: string, kind: 'failover' | 'failback' | 'test') => {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'failover') await drApi.failover(id)
      else if (kind === 'failback') await drApi.failback(id)
      else await drApi.test(id)
      load()
    } catch {
      setError(`Failed to ${kind} DR plan`)
    } finally {
      setBusy(false)
    }
  }

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id.slice(0, 8)

  return (
    <Box>
      <PageHeader
        title="Disaster Recovery"
        subtitle="Site replication, failover orchestration and DR testing"
        actions={<Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <LinearProgress />
      ) : (
        <>
          <Card sx={{ mb: 3 }}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="h6">DR Status</Typography>
              <StatusChip status={status} size="medium" />
              <Typography variant="caption" color="text.secondary">
                {prettyStatus(status)}
              </Typography>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <PublicIcon color="primary" />
                <Typography variant="h6">Sites</Typography>
                <Chip label={`${sites.length} sites`} size="small" />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setSiteDialog(true)}>
                  Register Site
                </Button>
              </Stack>
              {sites.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No DR sites registered
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Endpoint</TableCell>
                      <TableCell>Storage</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sites.map((s) => (
                      <TableRow key={s.id} hover>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{s.name}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{s.dr_type}</Typography></TableCell>
                        <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{s.endpoint}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{s.storage_id || '—'}</Typography></TableCell>
                        <TableCell>
                          <Chip label={s.is_primary ? 'Primary' : 'Replica'} size="small" color={s.is_primary ? 'primary' : 'default'} />
                        </TableCell>
                        <TableCell><StatusChip status={s.status} /></TableCell>
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
                <SwitchAccountIcon color="secondary" />
                <Typography variant="h6">Recovery Plans</Typography>
                <Chip label={`${plans.length} plans`} size="small" />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setPlanDialog(true)}>
                  New Plan
                </Button>
              </Stack>
              {plans.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No recovery plans yet
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Source → Target</TableCell>
                      <TableCell>VMs</TableCell>
                      <TableCell>RPO / RTO</TableCell>
                      <TableCell>Mode</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {plans.map((p) => (
                      <TableRow key={p.id} hover>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{p.name}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{siteName(p.source_site)} → {siteName(p.target_site)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{p.vms.length}</Typography></TableCell>
                        <TableCell>
                          <Typography variant="body2">{Math.round(p.replication_policy.rpo_seconds / 60)}m / {Math.round(p.replication_policy.rto_seconds / 3600)}h</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={p.auto_commit ? 'Auto-commit' : 'Manual'} size="small" color={p.auto_commit ? 'success' : 'default'} />
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            <Tooltip title="Test failover (non-destructive)">
                              <IconButton size="small" color="info" disabled={busy} onClick={() => action(p.id!, 'test')}>
                                <ScienceIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Failover">
                              <IconButton size="small" color="primary" disabled={busy} onClick={() => action(p.id!, 'failover')}>
                                <SwitchAccountIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Failback">
                              <IconButton size="small" color="warning" disabled={busy} onClick={() => action(p.id!, 'failback')}>
                                <UndoIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={siteDialog} onClose={() => setSiteDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Register DR Site</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Site name" value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} fullWidth required />
            <TextField
              select label="Site type" value={siteForm.dr_type}
              onChange={(e) => setSiteForm({ ...siteForm, dr_type: e.target.value })}
              fullWidth
            >
              {SITE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Endpoint" value={siteForm.endpoint} onChange={(e) => setSiteForm({ ...siteForm, endpoint: e.target.value })} fullWidth />
            <Stack direction="row" spacing={2}>
              <TextField label="Credentials id" value={siteForm.credentials_id} onChange={(e) => setSiteForm({ ...siteForm, credentials_id: e.target.value })} fullWidth />
              <TextField label="Storage id" value={siteForm.storage_id} onChange={(e) => setSiteForm({ ...siteForm, storage_id: e.target.value })} fullWidth />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSiteDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={registerSite}>Register</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={planDialog} onClose={() => setPlanDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Recovery Plan</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Plan name" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} fullWidth required />
            <TextField
              select label="Source site" value={planForm.source_site}
              onChange={(e) => setPlanForm({ ...planForm, source_site: e.target.value })}
              fullWidth required
            >
              {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
            <TextField
              select label="Target site" value={planForm.target_site}
              onChange={(e) => setPlanForm({ ...planForm, target_site: e.target.value })}
              fullWidth required
            >
              {sites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
            <TextField label="VM names (comma-separated)" value={planForm.vms} onChange={(e) => setPlanForm({ ...planForm, vms: e.target.value })} fullWidth />
            <TextField label="Failover order (comma-separated)" value={planForm.failover_order} onChange={(e) => setPlanForm({ ...planForm, failover_order: e.target.value })} fullWidth />
            <Stack direction="row" spacing={2}>
              <TextField label="RPO (seconds)" type="number" value={planForm.replication_policy.rpo_seconds}
                onChange={(e) => setPlanForm({ ...planForm, replication_policy: { ...planForm.replication_policy, rpo_seconds: Number(e.target.value) } })} fullWidth />
              <TextField label="RTO (seconds)" type="number" value={planForm.replication_policy.rto_seconds}
                onChange={(e) => setPlanForm({ ...planForm, replication_policy: { ...planForm.replication_policy, rto_seconds: Number(e.target.value) } })} fullWidth />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlanDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={createPlan}>Create Plan</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
