import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, IconButton, Tooltip, Typography, Stack, LinearProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteIcon from '@mui/icons-material/Delete'
import RestoreIcon from '@mui/icons-material/Restore'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, formatTs, prettyStatus } from '../utils'
import { snapshotsApi, jobsApi, reposApi, type Snapshot, type Job, type Repository } from '../api/client'
import { useNavigate } from 'react-router-dom'

export default function Snapshots() {
  const navigate = useNavigate()
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [repos, setRepos] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Snapshot | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, j, r] = await Promise.all([snapshotsApi.list(), jobsApi.list(), reposApi.list()])
      setSnapshots(s.data)
      setJobs(j.data)
      setRepos(r.data)
    } catch {
      setError('Failed to load snapshots')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async () => {
    if (!confirmDelete) return
    try {
      await snapshotsApi.remove(confirmDelete.id)
      setConfirmDelete(null)
      load()
    } catch {
      setError('Failed to delete snapshot')
    }
  }

  return (
    <Box>
      <PageHeader
        title="Snapshots"
        subtitle={`${snapshots.length} recovery points`}
        actions={<Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        <CardContent>
          {loading ? (
            <LinearProgress />
          ) : snapshots.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography color="text.secondary">No snapshots yet. Run a backup job to create one.</Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job</TableCell>
                  <TableCell>Repository</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Consistency</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell>Unique</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {snapshots.map((snap) => (
                  <TableRow key={snap.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {jobs.find((j) => j.id === snap.job_id)?.name ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{repos.find((r) => r.id === snap.repository_id)?.name ?? '—'}</Typography>
                    </TableCell>
                    <TableCell><Typography variant="body2">{prettyStatus(snap.snapshot_type)}</Typography></TableCell>
                    <TableCell><StatusChip status={snap.consistency} /></TableCell>
                    <TableCell><Typography variant="body2">{formatBytes(snap.size_bytes)}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{formatBytes(snap.unique_bytes)}</Typography></TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatTs(snap.created_at)}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Restore from this snapshot">
                          <IconButton size="small" color="primary" onClick={() => navigate('/restore', { state: { snapshot_id: snap.id } })}>
                            <RestoreIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => setConfirmDelete(snap)}>
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

      <Dialog open={confirmDelete != null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete snapshot?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">Delete this recovery point permanently?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={remove}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
