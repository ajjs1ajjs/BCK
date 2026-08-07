import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  IconButton, Tooltip, LinearProgress, Stack, Typography, Alert, Chip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import CloudIcon from '@mui/icons-material/Cloud'
import RestoreIcon from '@mui/icons-material/Restore'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatTs } from '../utils'
import { cloudApi, type CloudAccount, type CloudRestore, type CloudRestorableKind } from '../api/client'

const PROVIDERS = ['Aws', 'Azure', 'Gcp']

const EMPTY_ACCOUNT = {
  name: '',
  provider: 'Aws',
  auth_type: 'access_key',
  region: 'us-east-1',
  status: 'Connected',
  access_key: '',
  secret_key: '',
  tenant_id: '',
  client_id: '',
  client_secret: '',
  project_id: '',
}

export default function Cloud() {
  const [accounts, setAccounts] = useState<CloudAccount[]>([])
  const [restores, setRestores] = useState<CloudRestore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [form, setForm] = useState(EMPTY_ACCOUNT)
  const [confirmDelete, setConfirmDelete] = useState<CloudAccount | null>(null)

  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreKinds, setRestoreKinds] = useState<CloudRestorableKind[]>([])
  const [restoreForm, setRestoreForm] = useState({
    account_id: '',
    resource_type: '',
    resource_id: '',
    target_name: '',
    subscription_id: '',
    resource_group: '',
    zone: '',
  })

  const load = useCallback(async () => {
    try {
      const r = await cloudApi.list()
      setAccounts(r.data)
      const rr = await cloudApi.allRestores()
      setRestores(rr.data)
    } catch {
      setError('Failed to load cloud data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openRestore = async (account?: CloudAccount) => {
    const target = account ?? accounts[0]
    if (!target) return
    setRestoreForm({
      account_id: target.id!,
      resource_type: '',
      resource_id: '',
      target_name: '',
      subscription_id: '',
      resource_group: '',
      zone: '',
    })
    try {
      const kinds = await cloudApi.restorable(target.id!)
      setRestoreKinds(kinds.data)
    } catch {
      setRestoreKinds([])
    }
    setRestoreOpen(true)
    setError(null)
  }

  const switchRestoreAccount = async (accountId: string) => {
    setRestoreForm({ ...restoreForm, account_id: accountId, resource_type: '' })
    try {
      const kinds = await cloudApi.restorable(accountId)
      setRestoreKinds(kinds.data)
    } catch {
      setRestoreKinds([])
    }
  }

  const submitRestore = async () => {
    if (!restoreForm.account_id || !restoreForm.resource_type || !restoreForm.resource_id || !restoreForm.target_name) return
    setBusy(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (restoreForm.subscription_id) params.subscription_id = restoreForm.subscription_id
      if (restoreForm.resource_group) params.resource_group = restoreForm.resource_group
      if (restoreForm.zone) params.zone = restoreForm.zone
      await cloudApi.restore(restoreForm.account_id, {
        resource_type: restoreForm.resource_type,
        resource_id: restoreForm.resource_id,
        target_name: restoreForm.target_name,
        params,
      })
      setRestoreOpen(false)
      load()
    } catch {
      setError('Failed to submit cloud restore')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirmDelete) return
    setBusy(true)
    setError(null)
    try {
      await cloudApi.remove(confirmDelete.id!)
      setConfirmDelete(null)
      load()
    } catch {
      setError('Failed to remove cloud account')
    } finally {
      setBusy(false)
    }
  }

  const openCreate = () => {
    setForm({ ...EMPTY_ACCOUNT, provider: accounts.length ? accounts[0].provider : 'Aws' })
    setDialog(true)
    setError(null)
  }

  const submit = async () => {
    if (!form.name) return
    setBusy(true)
    setError(null)
    try {
      const payload: CloudAccount = {
        name: form.name,
        provider: form.provider as CloudAccount['provider'],
        auth_type: form.auth_type,
        region: form.region,
        status: 'Connected',
        access_key: form.access_key || undefined,
        secret_key: form.secret_key || undefined,
        tenant_id: form.tenant_id || undefined,
        client_id: form.client_id || undefined,
        client_secret: form.client_secret || undefined,
        project_id: form.project_id || undefined,
      }
      await cloudApi.register(payload)
      setDialog(false)
      load()
    } catch {
      setError('Failed to register cloud account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      <PageHeader
        title="Cloud Accounts"
        subtitle="AWS, Azure and GCP infrastructure backup accounts"
        actions={
          <>
            <Button variant="outlined" startIcon={<RestoreIcon />} disabled={accounts.length === 0} onClick={() => openRestore()}>Cloud Restore</Button>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Register Account</Button>
          </>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        <CardContent>
          {loading ? (
            <LinearProgress />
          ) : accounts.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <CloudIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography color="text.secondary" gutterBottom>No cloud accounts registered</Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Register your first account</Button>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Auth</TableCell>
                  <TableCell>Region</TableCell>
                  <TableCell>Credentials</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id} hover>
                    <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{a.name}</Typography></TableCell>
                    <TableCell><Chip label={a.provider} size="small" color={a.provider === 'Aws' ? 'primary' : a.provider === 'Azure' ? 'secondary' : 'default'} /></TableCell>
                    <TableCell><Typography variant="body2">{a.auth_type}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{a.region}</Typography></TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {a.access_key ? `AK: ${a.access_key.slice(0, 4)}…` : ''}
                        {a.client_id ? `Client: ${a.client_id.slice(0, 6)}…` : ''}
                        {a.project_id ? `Project: ${a.project_id}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell><StatusChip status={a.status} /></TableCell>
                    <TableCell align="right">
                      <Tooltip title="Remove account">
                        <IconButton size="small" color="error" onClick={() => setConfirmDelete(a)}>
                          <DeleteIcon fontSize="small" />
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
            <RestoreIcon color="primary" />
            <Typography variant="h6">Cloud restores</Typography>
          </Stack>
          {restores.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No cloud restore operations yet. Use "Cloud Restore" to restore a backup from a registered account.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Resource</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Requested</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Result</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {restores.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Typography variant="body2">
                        {accounts.find((a) => a.id === r.account_id)?.name ?? r.account_id.slice(0, 8)}
                      </Typography>
                    </TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.resource_type}</Typography></TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.resource_id}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{r.target_name}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{formatTs(r.requested_at)}</Typography></TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell>
                      <Typography variant="caption" color={r.status === 'Failed' ? 'error' : 'text.secondary'}>
                        {r.result ?? r.error ?? '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onClose={() => setDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Register Cloud Account</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Account name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
            <TextField
              select label="Provider" value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              fullWidth
            >
              {PROVIDERS.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField label="Auth type" value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })} fullWidth />
              <TextField label="Region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} fullWidth />
            </Stack>
            {form.provider === 'Aws' && (
              <>
                <TextField label="Access key" value={form.access_key} onChange={(e) => setForm({ ...form, access_key: e.target.value })} fullWidth />
                <TextField label="Secret key" type="password" value={form.secret_key} onChange={(e) => setForm({ ...form, secret_key: e.target.value })} fullWidth />
              </>
            )}
            {form.provider === 'Azure' && (
              <>
                <TextField label="Azure AD tenant id" value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })} fullWidth />
                <TextField label="Client (app) id" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} fullWidth />
                <TextField label="Client secret" type="password" value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} fullWidth />
              </>
            )}
            {form.provider === 'Gcp' && (
              <TextField label="Project id" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} fullWidth />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={submit}>Register</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete != null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Remove cloud account?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Remove &ldquo;{confirmDelete?.name}&rdquo;? This disconnects the provider credentials.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={remove}>Remove</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={restoreOpen} onClose={() => setRestoreOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cloud restore</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select label="Account" value={restoreForm.account_id}
              onChange={(e) => switchRestoreAccount(e.target.value)}
              fullWidth required
            >
              {accounts.map((a) => <MenuItem key={a.id} value={a.id!}>{a.name} ({a.provider})</MenuItem>)}
            </TextField>
            <TextField
              select label="Resource type" value={restoreForm.resource_type}
              onChange={(e) => setRestoreForm({ ...restoreForm, resource_type: e.target.value })}
              fullWidth required
            >
              {restoreKinds.map((k) => <MenuItem key={k.resource_type} value={k.resource_type}>{k.label}</MenuItem>)}
            </TextField>
            <TextField label="Resource / backup id" value={restoreForm.resource_id}
              onChange={(e) => setRestoreForm({ ...restoreForm, resource_id: e.target.value })}
              fullWidth required placeholder="snap-0abc / rp-123 / image-name"
            />
            <TextField label={restoreForm.resource_type === 'ebs_snapshot' ? 'Availability zone' : 'Target name'} value={restoreForm.target_name}
              onChange={(e) => setRestoreForm({ ...restoreForm, target_name: e.target.value })}
              fullWidth required
            />
            {restoreForm.resource_type === 'vm_restore_point' && (
              <>
                <TextField label="Azure subscription id" value={restoreForm.subscription_id}
                  onChange={(e) => setRestoreForm({ ...restoreForm, subscription_id: e.target.value })} fullWidth />
                <TextField label="Azure resource group" value={restoreForm.resource_group}
                  onChange={(e) => setRestoreForm({ ...restoreForm, resource_group: e.target.value })} fullWidth />
              </>
            )}
            {restoreForm.resource_type === 'gce_image' && (
              <TextField label="Zone" value={restoreForm.zone}
                onChange={(e) => setRestoreForm({ ...restoreForm, zone: e.target.value })} fullWidth />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={submitRestore}>Restore</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
