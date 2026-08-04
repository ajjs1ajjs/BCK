import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  IconButton, Tooltip, Typography, Stack, LinearProgress, Alert,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import StorageIcon from '@mui/icons-material/Storage'
import CloudIcon from '@mui/icons-material/Cloud'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, prettyStatus } from '../utils'
import { reposApi, type Repository } from '../api/client'

const TYPES = ['local', 's3', 'azure', 'nfs']

export default function Repositories() {
  const [repos, setRepos] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', repo_type: 'local', path: '', bucket: '', region: '', endpoint: '' })
  const [confirmDelete, setConfirmDelete] = useState<Repository | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await reposApi.list()
      setRepos(r.data)
    } catch {
      setError('Failed to load repositories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!form.name || (form.repo_type === 'local' && !form.path)) {
      setError(form.repo_type === 'local' ? 'Name and path are required' : 'Name is required')
      return
    }
    setError(null)
    try {
      await reposApi.create({
        name: form.name,
        repo_type: form.repo_type,
        path: form.path || undefined,
        bucket: form.bucket || undefined,
        region: form.region || undefined,
        endpoint: form.endpoint || undefined,
      })
      setOpen(false)
      setForm({ name: '', repo_type: 'local', path: '', bucket: '', region: '', endpoint: '' })
      load()
    } catch {
      setError('Failed to create repository')
    }
  }

  const remove = async () => {
    if (!confirmDelete) return
    try {
      await reposApi.remove(confirmDelete.id)
      setConfirmDelete(null)
      load()
    } catch {
      setError('Failed to delete repository')
    }
  }

  return (
    <Box>
      <PageHeader
        title="Repositories"
        subtitle={`${repos.length} storage destinations`}
        actions={
          <>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setError(null); setOpen(true) }}>Add Repository</Button>
          </>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        <CardContent>
          {loading ? (
            <LinearProgress />
          ) : repos.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <StorageIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
              <Typography color="text.secondary" sx={{ mt: 1 }}>No repositories configured</Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Capacity</TableCell>
                  <TableCell>Used</TableCell>
                  <TableCell>Free</TableCell>
                  <TableCell>Encryption</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {repos.map((repo) => (
                  <TableRow key={repo.id} hover>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        {repo.repo_type === 'local' ? <StorageIcon fontSize="small" color="primary" /> : <CloudIcon fontSize="small" color="primary" />}
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{repo.name}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell><Typography variant="body2">{prettyStatus(repo.repo_type)}</Typography></TableCell>
                    <TableCell><StatusChip status={repo.status} /></TableCell>
                    <TableCell><Typography variant="body2">{formatBytes(repo.capacity_bytes)}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{formatBytes(repo.used_bytes)}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{formatBytes(repo.free_bytes)}</Typography></TableCell>
                    <TableCell>
                      <Typography variant="body2">{repo.encrypted ? 'Encrypted' : 'Plain'}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => setConfirmDelete(repo)}>
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

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Repository</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
            <TextField
              select
              label="Type"
              value={form.repo_type}
              onChange={(e) => setForm({ ...form, repo_type: e.target.value })}
              fullWidth
            >
              {TYPES.map((t) => <MenuItem key={t} value={t}>{prettyStatus(t)}</MenuItem>)}
            </TextField>
            {form.repo_type === 'local' && (
              <TextField label="Local path" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} fullWidth required placeholder="./data/backup-repo" />
            )}
            {form.repo_type === 's3' && (
              <>
                <TextField label="Bucket" value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })} fullWidth />
                <TextField label="Region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} fullWidth />
                <TextField label="Endpoint" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} fullWidth />
              </>
            )}
            {form.repo_type === 'azure' && (
              <TextField label="Container / connection string" value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })} fullWidth />
            )}
            {form.repo_type === 'nfs' && (
              <>
                <TextField label="Export path" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} fullWidth />
                <TextField label="Endpoint" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} fullWidth />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submit}>Add Repository</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete != null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete repository?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Delete &ldquo;{confirmDelete?.name}&rdquo;? This removes the repository configuration and its snapshots.
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
