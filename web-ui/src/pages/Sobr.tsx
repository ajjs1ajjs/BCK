import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Grid, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  IconButton, Tooltip, LinearProgress, Stack, Typography, Alert, Chip, Switch,
  FormControlLabel, InputAdornment,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import LayersIcon from '@mui/icons-material/Layers'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, prettyStatus } from '../utils'
import { sobrApi, type StorageTier, type SobrPolicy } from '../api/client'

const TIER_TYPES = ['Performance', 'Capacity', 'Archive']

const EMPTY_TIER = {
  name: '',
  tier_type: 'Performance',
  backend: 'local',
  backend_config: {},
  capacity_bytes: 0,
  used_bytes: 0,
  status: 'Online',
  priority: 10,
}

const EMPTY_POLICY = {
  name: '',
  performance_tier_id: '',
  capacity_tier_id: '',
  archive_tier_id: '',
  capacity_move_days: 7,
  archive_move_days: 30,
  seal_days: 90,
  retention_days: 365,
}

export default function Sobr() {
  const [tiers, setTiers] = useState<StorageTier[]>([])
  const [policies, setPolicies] = useState<SobrPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [tierDialog, setTierDialog] = useState(false)
  const [tierForm, setTierForm] = useState(EMPTY_TIER)

  const [policyDialog, setPolicyDialog] = useState(false)
  const [policyForm, setPolicyForm] = useState(EMPTY_POLICY)

  const load = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([sobrApi.tiers(), sobrApi.policies()])
      setTiers(t.data)
      setPolicies(p.data)
    } catch {
      setError('Failed to load SOBR configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addTier = async () => {
    if (!tierForm.name) return
    setBusy(true)
    setError(null)
    try {
      await sobrApi.addTier({
        ...tierForm,
        tier_type: tierForm.tier_type as StorageTier['tier_type'],
        capacity_bytes: Number(tierForm.capacity_bytes),
        priority: Number(tierForm.priority),
      })
      setTierDialog(false)
      setTierForm(EMPTY_TIER)
      load()
    } catch {
      setError('Failed to add SOBR tier')
    } finally {
      setBusy(false)
    }
  }

  const createPolicy = async () => {
    if (!policyForm.name) return
    setBusy(true)
    setError(null)
    try {
      await sobrApi.createPolicy({
        ...policyForm,
        performance_tier_id: policyForm.performance_tier_id,
        capacity_tier_id: policyForm.capacity_tier_id,
        archive_tier_id: policyForm.archive_tier_id || undefined,
        archive_move_days: policyForm.archive_move_days || undefined,
        seal_days: policyForm.seal_days || undefined,
        retention_days: policyForm.retention_days || undefined,
        capacity_move_days: Number(policyForm.capacity_move_days),
      })
      setPolicyDialog(false)
      setPolicyForm(EMPTY_POLICY)
      load()
    } catch {
      setError('Failed to create SOBR policy')
    } finally {
      setBusy(false)
    }
  }

  const executePolicy = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await sobrApi.execute(id)
    } catch {
      setError('Failed to execute SOBR policy')
    } finally {
      setBusy(false)
    }
  }

  const perfTierId = (name: string) => {
    const found = tiers.find((t) => t.name === name)
    return found ? found.id ?? '' : ''
  }

  return (
    <Box>
      <PageHeader
        title="SOBR — Scale-Out Repository"
        subtitle="Multi-tier storage with data lifecycle management"
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
                <LayersIcon color="primary" />
                <Typography variant="h6">Storage Tiers</Typography>
                <Chip label={`${tiers.length} tiers`} size="small" />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setTierDialog(true)}>
                  Add Tier
                </Button>
              </Stack>
              {tiers.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No tiers configured yet
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Backend</TableCell>
                      <TableCell>Capacity</TableCell>
                      <TableCell>Used</TableCell>
                      <TableCell>Utilisation</TableCell>
                      <TableCell>Priority</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tiers.map((t) => {
                      const pct = t.capacity_bytes ? Math.round((t.used_bytes / t.capacity_bytes) * 100) : 0
                      return (
                        <TableRow key={t.id} hover>
                          <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography></TableCell>
                          <TableCell><Typography variant="body2">{t.tier_type}</Typography></TableCell>
                          <TableCell>
                            <Typography variant="body2">{t.backend}</Typography>
                            <Typography variant="caption" color="text.secondary">{JSON.stringify(t.backend_config)}</Typography>
                          </TableCell>
                          <TableCell><Typography variant="body2">{formatBytes(t.capacity_bytes)}</Typography></TableCell>
                          <TableCell><Typography variant="body2">{formatBytes(t.used_bytes)}</Typography></TableCell>
                          <TableCell>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <Box sx={{ width: 80, bgcolor: '#EDF0F5', borderRadius: 1, height: 6 }}>
                                <Box sx={{ width: `${pct}%`, bgcolor: pct > 90 ? '#E53935' : '#1E88E5', height: 6, borderRadius: 1 }} />
                              </Box>
                              <Typography variant="caption" color="text.secondary">{pct}%</Typography>
                            </Stack>
                          </TableCell>
                          <TableCell><Typography variant="body2">{t.priority}</Typography></TableCell>
                          <TableCell><StatusChip status={t.status} /></TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <LayersIcon color="secondary" />
                <Typography variant="h6">Lifecycle Policies</Typography>
                <Chip label={`${policies.length} policies`} size="small" />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setPolicyDialog(true)}>
                  New Policy
                </Button>
              </Stack>
              {policies.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No lifecycle policies yet
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Performance</TableCell>
                      <TableCell>Capacity</TableCell>
                      <TableCell>Archive</TableCell>
                      <TableCell>Move → Capacity</TableCell>
                      <TableCell>Archive</TableCell>
                      <TableCell>Retention</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {policies.map((p) => (
                      <TableRow key={p.id} hover>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{p.name}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{perfTierId(p.performance_tier_id) || p.performance_tier_id.slice(0, 8)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{perfTierId(p.capacity_tier_id) || p.capacity_tier_id.slice(0, 8)}</Typography></TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {p.archive_tier_id ? (perfTierId(p.archive_tier_id) || p.archive_tier_id.slice(0, 8)) : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell><Typography variant="body2">{p.capacity_move_days}d</Typography></TableCell>
                        <TableCell><Typography variant="body2">{p.archive_move_days ? `${p.archive_move_days}d` : '—'}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{p.retention_days ? `${p.retention_days}d` : '∞'}</Typography></TableCell>
                        <TableCell align="right">
                          <Tooltip title="Run data movement now">
                            <IconButton size="small" color="primary" disabled={busy} onClick={() => executePolicy(p.id!)}>
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
        </>
      )}

      <Dialog open={tierDialog} onClose={() => setTierDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Storage Tier</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={tierForm.name} onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })} fullWidth required />
            <TextField
              select label="Tier type" value={tierForm.tier_type}
              onChange={(e) => setTierForm({ ...tierForm, tier_type: e.target.value })}
              fullWidth
            >
              {TIER_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Backend" value={tierForm.backend} onChange={(e) => setTierForm({ ...tierForm, backend: e.target.value })} fullWidth />
            <TextField
              label="Capacity" type="number" value={tierForm.capacity_bytes}
              onChange={(e) => setTierForm({ ...tierForm, capacity_bytes: Number(e.target.value) })}
              fullWidth InputProps={{ endAdornment: <InputAdornment position="end">bytes</InputAdornment> }}
            />
            <TextField
              label="Priority" type="number" value={tierForm.priority}
              onChange={(e) => setTierForm({ ...tierForm, priority: Number(e.target.value) })}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTierDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={addTier}>Add Tier</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={policyDialog} onClose={() => setPolicyDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Lifecycle Policy</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={policyForm.name} onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })} fullWidth required />
            <TextField
              select label="Performance tier" value={policyForm.performance_tier_id}
              onChange={(e) => setPolicyForm({ ...policyForm, performance_tier_id: e.target.value })}
              fullWidth required
            >
              {tiers.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
            </TextField>
            <TextField
              select label="Capacity tier" value={policyForm.capacity_tier_id}
              onChange={(e) => setPolicyForm({ ...policyForm, capacity_tier_id: e.target.value })}
              fullWidth required
            >
              {tiers.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
            </TextField>
            <TextField
              select label="Archive tier (optional)" value={policyForm.archive_tier_id}
              onChange={(e) => setPolicyForm({ ...policyForm, archive_tier_id: e.target.value })}
              fullWidth
            >
              <MenuItem value="">None</MenuItem>
              {tiers.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField label="Move to capacity (days)" type="number" value={policyForm.capacity_move_days}
                onChange={(e) => setPolicyForm({ ...policyForm, capacity_move_days: Number(e.target.value) })} fullWidth />
              <TextField label="Move to archive (days)" type="number" value={policyForm.archive_move_days}
                onChange={(e) => setPolicyForm({ ...policyForm, archive_move_days: Number(e.target.value) })} fullWidth />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Seal (days)" type="number" value={policyForm.seal_days}
                onChange={(e) => setPolicyForm({ ...policyForm, seal_days: Number(e.target.value) })} fullWidth />
              <TextField label="Retention (days)" type="number" value={policyForm.retention_days}
                onChange={(e) => setPolicyForm({ ...policyForm, retention_days: Number(e.target.value) })} fullWidth />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPolicyDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={createPolicy}>Create Policy</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
