import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  IconButton, Tooltip, LinearProgress, Stack, Typography, Switch, FormControlLabel, Alert,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopCircleIcon from '@mui/icons-material/StopCircle'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, formatRelative, prettyStatus } from '../utils'
import {
  jobsApi, reposApi, type Job, type Repository, type CreateJobPayload,
} from '../api/client'

interface JobDialogState {
  open: boolean
  editing: Job | null
}

const EMPTY_FORM = {
  name: '',
  source_path: '',
  repository_id: '',
  backup_type: 'full',
  schedule: '',
  description: '',
  enabled: true,
}

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [repos, setRepos] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)
  const [dialog, setDialog] = useState<JobDialogState>({ open: false, editing: null })
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Job | null>(null)

  const load = useCallback(async () => {
    try {
      const [j, r] = await Promise.all([jobsApi.list(), reposApi.list()])
      setJobs(j.data)
      setRepos(r.data)
    } catch {
      setError('Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status.toLowerCase().includes('running') || j.status.toLowerCase().includes('pending'))
    if (hasRunning && !polling) setPolling(true)
    if (!hasRunning && polling) setPolling(false)
  }, [jobs, polling])

  useEffect(() => {
    if (!polling) return
    const t = setInterval(() => jobsApi.list().then((r) => setJobs(r.data)).catch(() => {}), 3000)
    return () => clearInterval(t)
  }, [polling])

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, repository_id: repos[0]?.id ?? '' })
    setDialog({ open: true, editing: null })
    setError(null)
  }

  const openEdit = (job: Job) => {
    setForm({
      name: job.name,
      source_path: job.source_path,
      repository_id: job.repository_id,
      backup_type: job.backup_type,
      schedule: job.schedule ?? '',
      description: job.description ?? '',
      enabled: job.enabled,
    })
    setDialog({ open: true, editing: job })
    setError(null)
  }

  const submit = async () => {
    if (!form.name || !form.source_path || !form.repository_id) {
      setError('Name, source path and repository are required')
      return
    }
    setError(null)
    try {
      const payload: CreateJobPayload = {
        name: form.name,
        source_path: form.source_path,
        repository_id: form.repository_id,
        backup_type: form.backup_type,
        schedule: form.schedule || undefined,
        description: form.description || undefined,
      }
      if (dialog.editing) {
        await jobsApi.update(dialog.editing.id, {
          name: payload.name,
          schedule: payload.schedule,
          enabled: form.enabled,
        })
      } else {
        await jobsApi.create(payload)
        if (!form.enabled) {
          const created = (await jobsApi.list()).data.find((j) => j.name === form.name)
          if (created) await jobsApi.update(created.id, { enabled: false })
        }
      }
      setDialog({ open: false, editing: null })
      load()
    } catch {
      setError('Failed to save job')
    }
  }

  const runJob = async (id: string) => {
    await jobsApi.run(id)
    load()
  }

  const cancelJob = async (id: string) => {
    await jobsApi.cancel(id)
    load()
  }

  const removeJob = async () => {
    if (!confirmDelete) return
    try {
      await jobsApi.remove(confirmDelete.id)
      setConfirmDelete(null)
      load()
    } catch {
      setError('Failed to delete job')
    }
  }

  return (
    <Box>
      <PageHeader
        title="Backup Jobs"
        subtitle={`${jobs.length} configured · ${jobs.filter((j) => j.status.toLowerCase().includes('running')).length} running`}
        actions={
          <>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={repos.length === 0}>
              New Job
            </Button>
          </>
        }
      />

      {repos.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No repositories configured. Create a repository first to add backup jobs.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        <CardContent>
          {loading ? (
            <LinearProgress />
          ) : jobs.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography color="text.secondary" gutterBottom>No backup jobs yet</Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={repos.length === 0}>
                Create your first job
              </Button>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Repository</TableCell>
                  <TableCell>Schedule</TableCell>
                  <TableCell sx={{ width: 180 }}>Status / Progress</TableCell>
                  <TableCell>Last Run</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{job.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{job.description || prettyStatus(job.backup_type)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{prettyStatus(job.backup_type)}</Typography>
                      <Typography variant="caption" color="text.secondary">{prettyStatus(job.job_type)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{repos.find((r) => r.id === job.repository_id)?.name ?? job.repository_id.slice(0, 8)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {job.schedule || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <StatusChip status={job.status} />
                        {job.progress > 0 && job.progress < 100 && (
                          <Box sx={{ flexGrow: 1 }}>
                            <LinearProgress variant="determinate" value={job.progress} sx={{ height: 6 }} />
                          </Box>
                        )}
                      </Stack>
                      {job.progress > 0 && (
                        <Typography variant="caption" color="text.secondary">{job.progress.toFixed(0)}%</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatRelative(job.last_run_at)}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title={job.enabled ? 'Run now' : 'Job disabled'}>
                          <span>
                            <IconButton size="small" color="primary" onClick={() => runJob(job.id)} disabled={!job.enabled || job.status.toLowerCase().includes('running')}>
                              <PlayArrowIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        {job.status.toLowerCase().includes('running') && (
                          <Tooltip title="Cancel">
                            <IconButton size="small" color="warning" onClick={() => cancelJob(job.id)}>
                              <StopCircleIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => openEdit(job)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => setConfirmDelete(job)}>
                            <DeleteIcon fontSize="small" />
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

      <Dialog open={dialog.open} onClose={() => setDialog({ open: false, editing: null })} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog.editing ? 'Edit Job' : 'New Backup Job'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Job name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
            <TextField
              label="Source path"
              value={form.source_path}
              onChange={(e) => setForm({ ...form, source_path: e.target.value })}
              fullWidth
              required
              helperText="Local path to back up, e.g. C:/DATA or /srv/files"
            />
            <TextField
              select
              label="Repository"
              value={form.repository_id}
              onChange={(e) => setForm({ ...form, repository_id: e.target.value })}
              fullWidth
              required
              disabled={dialog.editing != null}
            >
              {repos.map((r) => (
                <MenuItem key={r.id} value={r.id}>{r.name} · {formatBytes(r.free_bytes)} free</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Backup type"
              value={form.backup_type}
              onChange={(e) => setForm({ ...form, backup_type: e.target.value })}
              fullWidth
            >
              <MenuItem value="full">Full</MenuItem>
              <MenuItem value="incremental">Incremental</MenuItem>
              <MenuItem value="differential">Differential</MenuItem>
            </TextField>
            <TextField
              label="Schedule (cron)"
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              fullWidth
              placeholder="0 2 * * *"
              helperText="Leave empty to run manually only"
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              fullWidth
              multiline
              minRows={2}
            />
            <FormControlLabel
              control={<Switch checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />}
              label="Job enabled"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog({ open: false, editing: null })}>Cancel</Button>
          <Button variant="contained" onClick={submit}>{dialog.editing ? 'Save Changes' : 'Create Job'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete != null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete job?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Delete &ldquo;{confirmDelete?.name}&rdquo;? This removes the job configuration but keeps existing snapshots.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={removeJob}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
