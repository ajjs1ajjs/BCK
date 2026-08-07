import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  IconButton, Tooltip, LinearProgress, Stack, Typography, Alert, Chip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import EjectIcon from '@mui/icons-material/Eject'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import AlbumIcon from '@mui/icons-material/Album'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, formatTs } from '../utils'
import { tapeApi, type TapeDrive, type TapeMedia } from '../api/client'

const DRIVE_TYPES = ['LTO-9', 'LTO-8', 'LTO-7', 'LTFS']
const MEDIA_TYPES = ['LTO-9', 'LTO-8', 'LTO-7']

const EMPTY_DRIVE = {
  name: '',
  device_path: '',
  drive_type: 'LTO-9',
  status: 'Online',
  capacity_bytes: 18000000000000,
  used_bytes: 0,
}

const EMPTY_MEDIA = {
  barcode: '',
  media_type: 'LTO-9',
  capacity_bytes: 18000000000000,
  used_bytes: 0,
  status: 'Available',
  location: 'Library slot',
}

export default function Tape() {
  const [drives, setDrives] = useState<TapeDrive[]>([])
  const [media, setMedia] = useState<TapeMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [driveDialog, setDriveDialog] = useState(false)
  const [driveForm, setDriveForm] = useState(EMPTY_DRIVE)
  const [mediaDialog, setMediaDialog] = useState(false)
  const [mediaForm, setMediaForm] = useState(EMPTY_MEDIA)
  const [formatDialog, setFormatDialog] = useState(false)
  const [formatForm, setFormatForm] = useState({ device_path: '', barcode: '', capacity_bytes: 18000000000000 })

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([tapeApi.drives(), tapeApi.media()])
      setDrives(d.data)
      setMedia(m.data)
    } catch {
      setError('Failed to load tape library')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const registerDrive = async () => {
    if (!driveForm.name) return
    setBusy(true)
    setError(null)
    try {
      await tapeApi.registerDrive(driveForm)
      setDriveDialog(false)
      setDriveForm(EMPTY_DRIVE)
      load()
    } catch {
      setError('Failed to register tape drive')
    } finally {
      setBusy(false)
    }
  }

  const addMedia = async () => {
    if (!mediaForm.barcode) return
    setBusy(true)
    setError(null)
    try {
      await tapeApi.addMedia(mediaForm)
      setMediaDialog(false)
      setMediaForm(EMPTY_MEDIA)
      load()
    } catch {
      setError('Failed to add tape media')
    } finally {
      setBusy(false)
    }
  }

  const formatMedia = async () => {
    setBusy(true)
    setError(null)
    try {
      await tapeApi.formatMedia(formatForm)
      setFormatDialog(false)
      setFormatForm({ device_path: '', barcode: '', capacity_bytes: 18000000000000 })
      load()
    } catch {
      setError('Failed to format tape media')
    } finally {
      setBusy(false)
    }
  }

  const loadMedia = async (driveId: string, mediaId: string) => {
    setBusy(true)
    setError(null)
    try {
      await tapeApi.loadMedia(driveId, mediaId)
      load()
    } catch {
      setError('Failed to load media into drive')
    } finally {
      setBusy(false)
    }
  }

  const ejectMedia = async (driveId: string) => {
    setBusy(true)
    setError(null)
    try {
      await tapeApi.ejectMedia(driveId)
      load()
    } catch {
      setError('Failed to eject media')
    } finally {
      setBusy(false)
    }
  }

  const applyRetention = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await tapeApi.applyRetention()
      setError(null)
      load()
      alert(`Retention applied — ${r.data.media_released} media released`)
    } catch {
      setError('Failed to apply tape retention')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      <PageHeader
        title="Tape Library"
        subtitle="LTFS tape drives and media pool"
        actions={
          <>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button variant="outlined" startIcon={<DeleteSweepIcon />} disabled={busy} onClick={applyRetention}>
              Apply Retention
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDriveDialog(true)}>Add Drive</Button>
          </>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <LinearProgress />
      ) : (
        <>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <AlbumIcon color="primary" />
                <Typography variant="h6">Drives</Typography>
                <Chip label={`${drives.length} drives`} size="small" />
              </Stack>
              {drives.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No tape drives registered
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Device</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Loaded Media</TableCell>
                      <TableCell>Capacity</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {drives.map((d) => (
                      <TableRow key={d.id} hover>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{d.name}</Typography></TableCell>
                        <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{d.device_path}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{d.drive_type}</Typography></TableCell>
                        <TableCell>
                          {d.loaded_media ? (
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{d.loaded_media}</Typography>
                          ) : (
                            <Typography variant="body2" color="text.secondary">empty</Typography>
                          )}
                        </TableCell>
                        <TableCell><Typography variant="body2">{formatBytes(d.capacity_bytes)}</Typography></TableCell>
                        <TableCell><StatusChip status={d.status} /></TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            {!d.loaded_media && (
                              <Tooltip title="Load media">
                                <span>
                                  <IconButton size="small" color="primary" disabled={busy || media.length === 0}
                                    onClick={() => loadMedia(d.id!, media.find((m) => m.status === 'Available')!.id!)}>
                                    <UploadFileIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                            {d.loaded_media && (
                              <Tooltip title="Eject media">
                                <IconButton size="small" color="warning" disabled={busy} onClick={() => ejectMedia(d.id!)}>
                                  <EjectIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Stack>
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
                <AlbumIcon color="secondary" />
                <Typography variant="h6">Media Pool</Typography>
                <Chip label={`${media.length} media`} size="small" />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="outlined" onClick={() => setFormatDialog(true)}>Format Media</Button>
                <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setMediaDialog(true)}>Add Media</Button>
              </Stack>
              {media.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No tape media in the pool
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Barcode</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Capacity</TableCell>
                      <TableCell>Used</TableCell>
                      <TableCell>Location</TableCell>
                      <TableCell>Retention Until</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {media.map((m) => (
                      <TableRow key={m.id} hover>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>{m.barcode}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{m.media_type}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{formatBytes(m.capacity_bytes)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{formatBytes(m.used_bytes)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{m.location}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{formatTs(m.retention_until)}</Typography></TableCell>
                        <TableCell><StatusChip status={m.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={driveDialog} onClose={() => setDriveDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Tape Drive</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Drive name" value={driveForm.name} onChange={(e) => setDriveForm({ ...driveForm, name: e.target.value })} fullWidth required />
            <TextField label="Device path" value={driveForm.device_path} onChange={(e) => setDriveForm({ ...driveForm, device_path: e.target.value })} fullWidth placeholder="/dev/nst0 or D:\" />
            <TextField
              select label="Drive type" value={driveForm.drive_type}
              onChange={(e) => setDriveForm({ ...driveForm, drive_type: e.target.value })}
              fullWidth
            >
              {DRIVE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDriveDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={registerDrive}>Add Drive</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={mediaDialog} onClose={() => setMediaDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Tape Media</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Barcode" value={mediaForm.barcode} onChange={(e) => setMediaForm({ ...mediaForm, barcode: e.target.value })} fullWidth required />
            <TextField
              select label="Media type" value={mediaForm.media_type}
              onChange={(e) => setMediaForm({ ...mediaForm, media_type: e.target.value })}
              fullWidth
            >
              {MEDIA_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Location" value={mediaForm.location} onChange={(e) => setMediaForm({ ...mediaForm, location: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMediaDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={addMedia}>Add Media</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={formatDialog} onClose={() => setFormatDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Format Tape Media</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Device path" value={formatForm.device_path} onChange={(e) => setFormatForm({ ...formatForm, device_path: e.target.value })} fullWidth required />
            <TextField label="Barcode" value={formatForm.barcode} onChange={(e) => setFormatForm({ ...formatForm, barcode: e.target.value })} fullWidth required />
            <TextField label="Capacity (bytes)" type="number" value={formatForm.capacity_bytes}
              onChange={(e) => setFormatForm({ ...formatForm, capacity_bytes: Number(e.target.value) })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormatDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={formatMedia}>Format</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
