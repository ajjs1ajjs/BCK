import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Box, Card, CardContent, Grid, TextField, MenuItem, Button, Typography, Stack,
  Table, TableHead, TableBody, TableRow, TableCell, IconButton, Tooltip, LinearProgress, Alert,
  Chip, Checkbox, FormControlLabel,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import FolderIcon from '@mui/icons-material/Folder'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import RestoreIcon from '@mui/icons-material/Restore'
import PageHeader from '../components/PageHeader'
import { formatBytes, formatTs, prettyStatus } from '../utils'
import { snapshotsApi, jobsApi, restoreApi, type Snapshot, type Job } from '../api/client'

interface FileEntry {
  path: string
  size: number
  is_directory: boolean
  modified_at?: number
}

export default function Restore() {
  const location = useLocation()
  const initialSnapshot = (location.state as any)?.snapshot_id as string | undefined

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [snapshotId, setSnapshotId] = useState(initialSnapshot ?? '')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targetPath, setTargetPath] = useState('./restored')
  const [overwrite, setOverwrite] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [session, setSession] = useState<{ session_id: string; status: string; target: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadSnapshots = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([snapshotsApi.list(), jobsApi.list()])
      setSnapshots(s.data)
      setJobs(j.data)
      if (!snapshotId && s.data.length > 0) {
        setSnapshotId(s.data[0].id)
      }
    } catch {
      setError('Failed to load snapshots')
    }
  }, [snapshotId])

  useEffect(() => { loadSnapshots() }, [])

  const explore = useCallback(async (sid: string) => {
    if (!sid) return
    setLoadingFiles(true)
    setError(null)
    try {
      const r = await restoreApi.explore(sid)
      setFiles(r.data)
    } catch {
      setError('Failed to browse snapshot')
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  useEffect(() => {
    if (snapshotId) explore(snapshotId)
  }, [snapshotId, explore])

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const startRestore = async () => {
    if (!snapshotId) { setError('Select a snapshot'); return }
    if (selected.size === 0) { setError('Select at least one file'); return }
    if (!targetPath.trim()) { setError('Enter a target path'); return }
    setError(null)
    setRestoring(true)
    try {
      const r = await restoreApi.file({
        snapshot_id: snapshotId,
        files: Array.from(selected),
        target_path: targetPath,
        overwrite,
      })
      setSession(r.data)
      setSelected(new Set())
    } catch {
      setError('Restore failed')
    } finally {
      setRestoring(false)
    }
  }

  const snap = snapshots.find((s) => s.id === snapshotId)

  return (
    <Box>
      <PageHeader title="Restore" subtitle="Recover files from a snapshot" />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {session && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Restore started (session {session.session_id.slice(0, 8)}) — status: {prettyStatus(session.status)} → {session.target}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>1 · Select snapshot</Typography>
              <TextField
                select
                label="Snapshot"
                value={snapshotId}
                onChange={(e) => setSnapshotId(e.target.value)}
                fullWidth
                size="small"
              >
                {snapshots.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {jobs.find((j) => j.id === s.job_id)?.name ?? 'Job'} · {formatTs(s.created_at)}
                  </MenuItem>
                ))}
              </TextField>
              {snap && (
                <Stack spacing={0.75} sx={{ mt: 2 }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">Type</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{prettyStatus(snap.snapshot_type)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">Size</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{formatBytes(snap.size_bytes)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">Consistency</Typography>
                    <Chip label={prettyStatus(snap.consistency)} size="small" color="success" variant="outlined" sx={{ height: 20 }} />
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">Created</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{formatTs(snap.created_at)}</Typography>
                  </Stack>
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>2 · Restore options</Typography>
              <TextField
                label="Target path"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                fullWidth
                size="small"
                sx={{ mb: 1.5 }}
              />
              <FormControlLabel
                control={<Checkbox checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} size="small" />}
                label={<Typography variant="body2">Overwrite existing files</Typography>}
              />
              <Button
                variant="contained"
                startIcon={<RestoreIcon />}
                fullWidth
                onClick={startRestore}
                disabled={restoring || selected.size === 0}
                sx={{ mt: 1.5 }}
              >
                {restoring ? 'Restoring…' : `Restore ${selected.size} file${selected.size === 1 ? '' : 's'}`}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={9}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                <Typography variant="h6">3 · Select files</Typography>
                <Button size="small" startIcon={<RefreshIcon />} onClick={() => explore(snapshotId)}>Refresh</Button>
              </Stack>
              {loadingFiles ? (
                <LinearProgress />
              ) : files.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <FolderIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                  <Typography color="text.secondary">Select a snapshot to browse files</Typography>
                </Box>
              ) : (
                <>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" />
                        <TableCell>Name</TableCell>
                        <TableCell align="right">Size</TableCell>
                        <TableCell>Modified</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {files.map((f) => {
                        const name = f.path.split(/[\\/]/).pop() || f.path
                        const parent = f.path.split(/[\\/]/).slice(0, -1).join('/')
                        return (
                          <TableRow key={f.path} hover selected={selected.has(f.path)} sx={{ cursor: 'pointer' }} onClick={() => toggle(f.path)}>
                            <TableCell padding="checkbox">
                              <Checkbox checked={selected.has(f.path)} size="small" />
                            </TableCell>
                            <TableCell>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                {f.is_directory ? <FolderIcon fontSize="small" color="warning" /> : <InsertDriveFileIcon fontSize="small" color="action" />}
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{name}</Typography>
                                  {parent && <Typography variant="caption" color="text.secondary">{parent}</Typography>}
                                </Box>
                              </Stack>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2">{f.is_directory ? '—' : formatBytes(f.size)}</Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{formatTs(f.modified_at)}</Typography>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">{files.length} entries</Typography>
                    <Tooltip title="Select all files">
                      <Button size="small" onClick={() => {
                        if (selected.size === files.length) setSelected(new Set())
                        else setSelected(new Set(files.filter((f) => !f.is_directory).map((f) => f.path)))
                      }}>
                        {selected.size === files.length ? 'Clear all' : 'Select all'}
                      </Button>
                    </Tooltip>
                  </Stack>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
