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
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatTs } from '../utils'
import { hypervisorApi, reposApi, type Hypervisor, type HypervisorVm } from '../api/client'

export default function Hypervisors() {
  const [hypervisors, setHypervisors] = useState<Hypervisor[]>([])
  const [vms, setVms] = useState<Record<string, HypervisorVm[]>>({})
  const [repos, setRepos] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState<string | null>(null)

  const [backupVm, setBackupVm] = useState<{ hvId: string; vm: HypervisorVm } | null>(null)
  const [backupRepo, setBackupRepo] = useState('')
  const [backupName, setBackupName] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [h, r] = await Promise.all([hypervisorApi.list(), reposApi.list()])
      setHypervisors(h.data)
      setRepos(r.data.map((x) => ({ id: x.id, name: x.name })))
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
    </Box>
  )
}
