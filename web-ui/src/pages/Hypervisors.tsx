import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  IconButton, Tooltip, Stack, Typography, Alert, Chip, MenuItem, CircularProgress,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import BackupIcon from '@mui/icons-material/Backup'
import DnsIcon from '@mui/icons-material/Dns'
import MemoryIcon from '@mui/icons-material/Memory'
import BoltIcon from '@mui/icons-material/Bolt'
import StopIcon from '@mui/icons-material/Stop'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatTs } from '../utils'
import {
  hypervisorApi, reposApi, instantRecoveryApi,
  type Hypervisor, type HypervisorVm, type InstantRecoverySession,
} from '../api/client'

export default function Hypervisors() {
  const [hypervisors, setHypervisors] = useState<Hypervisor[]>([])
  const [vms, setVms] = useState<Record<string, HypervisorVm[]>>({})
  const [repos, setRepos] = useState<{ id: string; name: string }[]>([])
  const [sessions, setSessions] = useState<InstantRecoverySession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState<string | null>(null)

  const [backupVm, setBackupVm] = useState<{ hvId: string; vm: HypervisorVm } | null>(null)
  const [backupRepo, setBackupRepo] = useState('')
  const [backupName, setBackupName] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [irVm, setIrVm] = useState<{ hvId: string; vm: HypervisorVm } | null>(null)
  const [irSnapshot, setIrSnapshot] = useState('')
  const [irProtocol, setIrProtocol] = useState('nfs')
  const [irDatastore, setIrDatastore] = useState('')
  const [irPowerOn, setIrPowerOn] = useState(true)
  const [irBusy, setIrBusy] = useState(false)
  const [irMsg, setIrMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [h, r, s] = await Promise.all([
        hypervisorApi.list(),
        reposApi.list(),
        instantRecoveryApi.list(),
      ])
      setHypervisors(h.data)
      setRepos(r.data.map((x) => ({ id: x.id, name: x.name })))
      setSessions(s.data)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to load hypervisors')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const discover = async (id: string) => {
    setDiscovering(id)
    try {
      const r = await hypervisorApi.vms(id)
      setVms((prev) => ({ ...prev, [id]: r.data }))
      setExpanded(id)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to discover VMs')
    } finally {
      setDiscovering(null)
    }
  }

  const openBackup = (hvId: string, vm: HypervisorVm) => {
    setBackupVm({ hvId, vm })
    setBackupRepo(repos[0]?.id || '')
    setBackupName(`vm-backup-${vm.name}`)
    setBackupMsg(null)
  }

  const startBackup = async () => {
    if (!backupVm) return
    setBackupBusy(true)
    setBackupMsg(null)
    try {
      await hypervisorApi.backupVm(backupVm.hvId, backupVm.vm.mo_ref, {
        repository_id: backupRepo,
        name: backupName,
        vm_name: backupVm.vm.name,
      })
      setBackupMsg({ ok: true, text: `Backup job "${backupName}" started.` })
      setBackupVm(null)
    } catch (e: any) {
      setBackupMsg({ ok: false, text: e?.response?.data?.detail || e?.message || 'Failed to start backup' })
    } finally {
      setBackupBusy(false)
    }
  }

  const openInstantRecover = (hvId: string, vm: HypervisorVm) => {
    setIrVm({ hvId, vm })
    setIrSnapshot('')
    setIrProtocol('nfs')
    setIrDatastore('')
    setIrPowerOn(true)
    setIrMsg(null)
  }

  const startInstantRecover = async () => {
    if (!irVm) return
    setIrBusy(true)
    setIrMsg(null)
    try {
      await instantRecoveryApi.vm({
        snapshot_id: irSnapshot,
        vm_name: `ir-${irVm.vm.name}`,
        hypervisor_id: irVm.hvId,
        protocol: irProtocol,
        target_host: '',
        datastore: irDatastore || undefined,
        power_on: irPowerOn,
      })
      setIrMsg({ ok: true, text: 'Instant recovery started. The VM boots from the backup.' })
      setIrVm(null)
      load()
    } catch (e: any) {
      setIrMsg({ ok: false, text: e?.response?.data?.detail || e?.message || 'Failed to start instant recovery' })
    } finally {
      setIrBusy(false)
    }
  }

  const stopSession = async (id: string) => {
    try {
      await instantRecoveryApi.stop(id)
      load()
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to stop session')
    }
  }

  return (
    <Box>
      <PageHeader
        title="Hypervisors & Virtual Machines"
        subtitle="Register hypervisors, discover VMs and run full VM backups"
        actions={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>
            Refresh
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Card>
          <CardContent>
            {hypervisors.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No hypervisors registered yet.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Host</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>VMs</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {hypervisors.map((hv) => {
                    const vmList = vms[hv.id] || []
                    return (
                      <TableRow key={hv.id}>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <DnsIcon fontSize="small" color="primary" />
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{hv.name}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{hv.hv_type}</TableCell>
                        <TableCell>{hv.host}:{hv.port}</TableCell>
                        <TableCell><StatusChip status={hv.status} /></TableCell>
                        <TableCell>
                          <Button size="small" onClick={() => discover(hv.id)} disabled={discovering === hv.id}>
                            {discovering === hv.id ? 'Discovering…' : vmList.length ? `${vmList.length} VMs` : 'Discover'}
                          </Button>
                        </TableCell>
                        <TableCell align="right">
                          {expanded === hv.id && vmList.length > 0 && (
                            <Chip label="expanded" size="small" color="info" sx={{ mr: 1 }} />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {expanded && (vms[expanded] || []).length > 0 && (
        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              VMs on {hypervisors.find((h) => h.id === expanded)?.name}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Power</TableCell>
                  <TableCell>CPU</TableCell>
                  <TableCell>RAM</TableCell>
                  <TableCell>Disk</TableCell>
                  <TableCell>Protection</TableCell>
                  <TableCell>Last backup</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vms[expanded].map((vm) => (
                  <TableRow key={vm.id}>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <MemoryIcon fontSize="small" color="action" />
                        <Typography variant="body2">{vm.name}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell><StatusChip status={vm.power_state} /></TableCell>
                    <TableCell>{vm.cpu_count}</TableCell>
                    <TableCell>{vm.ram_mb} MB</TableCell>
                    <TableCell>{vm.disk_gb} GB</TableCell>
                    <TableCell><StatusChip status={vm.protection_status} /></TableCell>
                    <TableCell>{vm.last_backup ? formatTs(vm.last_backup) : '—'}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Run full VM backup">
                        <IconButton size="small" color="primary" onClick={() => openBackup(expanded, vm)}>
                          <BackupIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Instant recovery (boot from backup)">
                        <IconButton size="small" color="secondary" onClick={() => openInstantRecover(expanded, vm)}>
                          <BoltIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {sessions.length > 0 && (
        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Active Instant Recovery sessions
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>VM</TableCell>
                  <TableCell>Snapshot</TableCell>
                  <TableCell>Protocol</TableCell>
                  <TableCell>Hypervisor</TableCell>
                  <TableCell>VM ref</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.session_id}>
                    <TableCell>{s.vm_name}</TableCell>
                    <TableCell>{s.snapshot_id}</TableCell>
                    <TableCell>{s.protocol}</TableCell>
                    <TableCell>{s.hypervisor_id || '—'}</TableCell>
                    <TableCell>{s.vm_ref || '—'}</TableCell>
                    <TableCell><StatusChip status={s.status} /></TableCell>
                    <TableCell align="right">
                      <Tooltip title="Stop & unregister VM">
                        <IconButton size="small" color="error" onClick={() => stopSession(s.session_id)}>
                          <StopIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(backupVm)} onClose={() => setBackupVm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Back up VM</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="VM"
              value={backupVm?.vm.name || ''}
              size="small"
              disabled
            />
            <TextField
              label="Job name"
              value={backupName}
              onChange={(e) => setBackupName(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              select
              label="Repository"
              value={backupRepo}
              onChange={(e) => setBackupRepo(e.target.value)}
              size="small"
              fullWidth
            >
              {repos.map((r) => (
                <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
              ))}
            </TextField>
            {backupMsg && !backupMsg.ok && (
              <Alert severity="error">{backupMsg.text}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBackupVm(null)}>Cancel</Button>
          <Button variant="contained" onClick={startBackup} disabled={backupBusy || !backupRepo}>
            {backupBusy ? 'Starting…' : 'Start backup'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(irVm)} onClose={() => setIrVm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Instant Recovery (boot from backup)</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="VM"
              value={irVm?.vm.name || ''}
              size="small"
              disabled
            />
            <TextField
              label="Snapshot ID"
              value={irSnapshot}
              onChange={(e) => setIrSnapshot(e.target.value)}
              size="small"
              fullWidth
              placeholder="id of an existing snapshot"
            />
            <TextField
              select
              label="Protocol"
              value={irProtocol}
              onChange={(e) => setIrProtocol(e.target.value)}
              size="small"
              fullWidth
            >
              <MenuItem value="nfs">NFS (VMware)</MenuItem>
              <MenuItem value="iscsi">iSCSI (Hyper-V)</MenuItem>
            </TextField>
            <TextField
              label="Datastore"
              value={irDatastore}
              onChange={(e) => setIrDatastore(e.target.value)}
              size="small"
              fullWidth
              placeholder="target datastore (optional)"
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={irPowerOn} onChange={(e) => setIrPowerOn(e.target.checked)} />
              <Typography variant="body2">Power on recovered VM</Typography>
            </label>
            {irMsg && !irMsg.ok && (
              <Alert severity="error">{irMsg.text}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIrVm(null)}>Cancel</Button>
          <Button variant="contained" onClick={startInstantRecover} disabled={irBusy || !irSnapshot}>
            {irBusy ? 'Starting…' : 'Boot from backup'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
