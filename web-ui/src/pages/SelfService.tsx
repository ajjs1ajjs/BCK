import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  IconButton, Tooltip, LinearProgress, Stack, Typography, Alert, Chip,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import SendIcon from '@mui/icons-material/Send'
import RestoreIcon from '@mui/icons-material/Restore'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatTs } from '../utils'
import {
  portalApi,
  type RestoreRequest,
  type PortalMe,
} from '../api/client'

export default function SelfService() {
  const [me, setMe] = useState<PortalMe | null>(null)
  const [mine, setMine] = useState<RestoreRequest[]>([])
  const [all, setAll] = useState<RestoreRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [submitOpen, setSubmitOpen] = useState(false)
  const [form, setForm] = useState({ snapshot_id: '', files: '', target_path: '', reason: '' })
  const [decision, setDecision] = useState<{ request: RestoreRequest; kind: 'approve' | 'reject' } | null>(null)
  const [decisionNote, setDecisionNote] = useState('')

  const load = useCallback(async () => {
    try {
      const [meRes, mineRes] = await Promise.all([portalApi.me(), portalApi.myRequests()])
      setMe(meRes.data)
      setMine(mineRes.data)
      if (meRes.data.can_approve) {
        const allRes = await portalApi.allRequests()
        setAll(allRes.data)
      }
    } catch {
      setError('Failed to load self-service data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!form.snapshot_id || !form.target_path) return
    setBusy(true)
    setError(null)
    try {
      await portalApi.submit({
        snapshot_id: form.snapshot_id,
        files: form.files.split('\n').map((s) => s.trim()).filter(Boolean),
        target_path: form.target_path,
        reason: form.reason,
      })
      setSubmitOpen(false)
      setForm({ snapshot_id: '', files: '', target_path: '', reason: '' })
      load()
    } catch {
      setError('Failed to submit restore request')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await portalApi.cancel(id)
      load()
    } catch {
      setError('Failed to cancel request')
    } finally {
      setBusy(false)
    }
  }

  const decide = async () => {
    if (!decision) return
    setBusy(true)
    setError(null)
    try {
      if (decision.kind === 'approve') {
        await portalApi.approve(decision.request.id, decisionNote)
      } else {
        await portalApi.reject(decision.request.id, decisionNote)
      }
      setDecision(null)
      setDecisionNote('')
      load()
    } catch {
      setError('Failed to update request')
    } finally {
      setBusy(false)
    }
  }

  const complete = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await portalApi.complete(id)
      load()
    } catch {
      setError('Failed to complete request')
    } finally {
      setBusy(false)
    }
  }

  const requestTable = (
    rows: RestoreRequest[],
    owner: boolean,
  ) => (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Snapshot</TableCell>
          {!owner && <TableCell>User</TableCell>}
          <TableCell>Target path</TableCell>
          <TableCell>Files</TableCell>
          <TableCell>Requested</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Decision</TableCell>
          <TableCell align="right">Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} hover>
            <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.snapshot_id}</Typography></TableCell>
            {!owner && <TableCell><Typography variant="body2">{r.username}</Typography></TableCell>}
            <TableCell><Typography variant="body2">{r.target_path}</Typography></TableCell>
            <TableCell>
              {r.files.length === 0 ? (
                <Typography variant="caption" color="text.secondary">—</Typography>
              ) : (
                <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {r.files.join(', ')}
                </Typography>
              )}
            </TableCell>
            <TableCell><Typography variant="body2">{formatTs(r.requested_at)}</Typography></TableCell>
            <TableCell><StatusChip status={r.status} /></TableCell>
            <TableCell>
              {r.decided_by ? (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip size="small" label={r.decided_by} />
                  {r.decision_note && (
                    <Tooltip title={r.decision_note}>
                      <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.decision_note}
                      </Typography>
                    </Tooltip>
                  )}
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">—</Typography>
              )}
            </TableCell>
            <TableCell align="right">
              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                {owner && r.status === 'Pending' && (
                  <Tooltip title="Cancel request">
                    <IconButton size="small" color="error" disabled={busy} onClick={() => cancel(r.id)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {!owner && r.status === 'Pending' && (
                  <>
                    <Tooltip title="Approve">
                      <IconButton size="small" color="success" disabled={busy} onClick={() => { setDecision({ request: r, kind: 'approve' }); setDecisionNote('') }}>
                        <CheckIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Reject">
                      <IconButton size="small" color="error" disabled={busy} onClick={() => { setDecision({ request: r, kind: 'reject' }); setDecisionNote('') }}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
                {!owner && r.status === 'Approved' && (
                  <Tooltip title="Mark complete">
                    <IconButton size="small" color="primary" disabled={busy} onClick={() => complete(r.id)}>
                      <CheckIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  return (
    <Box>
      <PageHeader
        title="Self-service portal"
        subtitle={me ? `${me.username} · ${me.role}${me.can_approve ? ' · approver' : ''}` : 'Restore requests'}
        actions={
          <>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setSubmitOpen(true)}>New Request</Button>
          </>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <LinearProgress />
      ) : (
        <Stack spacing={3}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <RestoreIcon color="primary" />
                <Typography variant="h6">My requests</Typography>
              </Stack>
              {mine.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No restore requests submitted yet.
                </Typography>
              ) : requestTable(mine, true)}
            </CardContent>
          </Card>

          {me?.can_approve && (
            <Card>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                  <SendIcon color="primary" />
                  <Typography variant="h6">Approval queue</Typography>
                </Stack>
                {all.length === 0 ? (
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No pending requests to review.
                  </Typography>
                ) : requestTable(all, false)}
              </CardContent>
            </Card>
          )}
        </Stack>
      )}

      <Dialog open={submitOpen} onClose={() => setSubmitOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New restore request</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Snapshot ID" value={form.snapshot_id} onChange={(e) => setForm({ ...form, snapshot_id: e.target.value })} fullWidth required />
            <TextField label="Target path" value={form.target_path} onChange={(e) => setForm({ ...form, target_path: e.target.value })} fullWidth required />
            <TextField
              label="Files to restore (one per line)"
              value={form.files}
              onChange={(e) => setForm({ ...form, files: e.target.value })}
              fullWidth
              multiline
              minRows={3}
              placeholder={'/etc/hosts\n/var/lib/mysql/backup.sql'}
            />
            <TextField label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} fullWidth multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubmitOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={submit}>Submit</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={decision != null} onClose={() => setDecision(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{decision?.kind === 'approve' ? 'Approve request' : 'Reject request'}</DialogTitle>
        <DialogContent>
          {decision && (
            <Stack spacing={1} sx={{ mt: 1 }}>
              <Typography variant="body2">
                <strong>User:</strong> {decision.request.username}
              </Typography>
              <Typography variant="body2">
                <strong>Snapshot:</strong> {decision.request.snapshot_id}
              </Typography>
              <Typography variant="body2">
                <strong>Target:</strong> {decision.request.target_path}
              </Typography>
              {decision.request.reason && (
                <Typography variant="body2">
                  <strong>Reason:</strong> {decision.request.reason}
                </Typography>
              )}
            </Stack>
          )}
          <TextField
            label="Note"
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDecision(null)}>Cancel</Button>
          <Button variant="contained" color={decision?.kind === 'approve' ? 'success' : 'error'} disabled={busy} onClick={decide}>
            {decision?.kind === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
