import { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Tooltip, alpha, IconButton, TextField,
  InputAdornment, Skeleton, Dialog, DialogTitle, DialogContent,
  DialogActions, CircularProgress, List, ListItem, ListItemText,
  Divider
} from '@mui/material';
import {
  Storage as StorageIcon, Folder as FolderIcon, InsertDriveFile as FileIcon,
  Refresh as RefreshIcon, Download as DownloadIcon, Delete as DeleteIcon,
  Search as SearchIcon, CloudDone as CloudDoneIcon, History as HistoryIcon,
  SettingsBackupRestore as RestoreIcon
} from '@mui/icons-material';
import { API } from '../utils/config';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function getStatusColor(status) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'warning';
  return 'default';
}

export default function Repos() {
  const [backups, setBackups] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(null);

  // S3 Versioning state
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [versioningData, setVersioningData] = useState(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);

  const token = localStorage.getItem('token') || '';
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [bRes, sRes] = await Promise.all([
        fetch(`${API}/api/backups?limit=500`, { headers }),
        fetch(`${API}/api/stats`, { headers }),
      ]);
      const bData = await bRes.json();
      const sData = await sRes.json();
      setBackups(bData.data || bData || []);
      setStats(sData);
    } catch (e) {
      console.error('Repos load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const filtered = useMemo(() => {
    if (!search) return backups;
    const q = search.toLowerCase();
    return backups.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.backupType || b.type || '').toLowerCase().includes(q) ||
      (b.destination || '').toLowerCase().includes(q)
    );
  }, [backups, search]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete backup "${name}"?`)) return;
    setDeleting(id);
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE', headers });
      setBackups(prev => prev.filter(b => b.id !== id));
    } catch (e) {
      alert('Delete failed: ' + e.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = (id) => {
    window.open(`${API}/api/backups/${id}/download?token=${token}`, '_blank');
  };

  const handleExport = (fmt) => {
    window.open(`${API}/api/backups/export?format=${fmt}&token=${token}`, '_blank');
  };

  // S3 versioning handlers
  const handleOpenVersions = async (backup) => {
    setSelectedBackup(backup);
    setVersionDialogOpen(true);
    setLoadingVersions(true);
    setVersioningData(null);
    try {
      const res = await fetch(`${API}/api/versions/${backup.id}`, { headers });
      if (!res.ok) {
        const errorText = await res.text();
        let parsedError = errorText;
        try { parsedError = JSON.parse(errorText).error; } catch (e) { parsedError = errorText; }
        throw new Error(parsedError || 'S3 versioning details not found or disabled.');
      }
      const data = await res.json();
      setVersioningData(data);
    } catch (e) {
      console.error('Failed to load S3 versions:', e);
      setVersioningData({ error: e.message });
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleEnableVersioning = async () => {
    if (!selectedBackup) return;
    try {
      const res = await fetch(`${API}/api/versions/${selectedBackup.id}/enable`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        alert('S3 Bucket Versioning enabled successfully!');
        handleOpenVersions(selectedBackup);
      } else {
        alert('Failed to enable versioning');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleRestoreVersion = async (versionId) => {
    if (!selectedBackup) return;
    if (!window.confirm(`Are you sure you want to restore version "${versionId}"?`)) return;
    try {
      const res = await fetch(`${API}/api/versions/${selectedBackup.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ versionId })
      });
      if (res.ok) {
        alert('Restore initiated successfully! Check Activity Log for status.');
        setVersionDialogOpen(false);
      } else {
        const err = await res.json();
        alert('Failed to initiate restore: ' + (err.error || res.statusText));
      }
    } catch (e) {
      alert('Error initiating restore: ' + e.message);
    }
  };

  // Aggregate stats
  const totalSize = useMemo(() => backups.reduce((acc, b) => acc + (b.size || 0), 0), [backups]);
  const completed = useMemo(() => backups.filter(b => b.status === 'completed').length, [backups]);
  const failed = useMemo(() => backups.filter(b => b.status === 'failed').length, [backups]);
  const diskUsedGB = stats?.diskSpace ? (stats.diskSpace.usedBytes / 1073741824).toFixed(1) : null;
  const diskTotalGB = stats?.diskSpace ? (stats.diskSpace.totalBytes / 1073741824).toFixed(1) : null;
  const diskPct = diskTotalGB > 0 ? Math.min(((diskUsedGB / diskTotalGB) * 100), 100) : 0;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Repositories</Typography>
          <Typography variant="body2" color="text.secondary">Backup storage overview and file management</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleExport('csv')}>Export CSV</Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleExport('json')}>Export JSON</Button>
          <Button size="small" variant="contained" startIcon={<RefreshIcon />} onClick={loadData}>Refresh</Button>
        </Stack>
      </Stack>

      {/* Stats Row */}
      <Grid container spacing={2} sx={{ mb: 3, mt: 0.5 }}>
        {[
          { label: 'Total Backups', value: loading ? '—' : backups.length, icon: <StorageIcon />, color: '#38bdf8' },
          { label: 'Completed', value: loading ? '—' : completed, icon: <CloudDoneIcon />, color: '#22c55e' },
          { label: 'Failed', value: loading ? '—' : failed, icon: <FolderIcon />, color: '#f87171' },
          { label: 'Total Size', value: loading ? '—' : formatBytes(totalSize), icon: <FileIcon />, color: '#a78bfa' },
        ].map((s) => (
          <Grid item xs={6} sm={3} key={s.label}>
            <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Box sx={{
                    p: 1, borderRadius: 1.5,
                    bgcolor: alpha(s.color, 0.12),
                    color: s.color, display: 'flex',
                  }}>
                    {s.icon}
                  </Box>
                  <Box>
                    <Typography variant="h6" fontWeight={700}>{s.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{s.label}</Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Disk Usage */}
      {stats?.diskSpace && (
        <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 3 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={600}>Disk Usage</Typography>
              <Typography variant="body2" color="text.secondary">
                {formatBytes(stats.diskSpace.usedBytes)} / {formatBytes(stats.diskSpace.totalBytes)}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={diskPct}
              sx={{
                height: 8, borderRadius: 4,
                bgcolor: 'action.hover',
                '& .MuiLinearProgress-bar': {
                  bgcolor: diskPct > 85 ? 'error.main' : diskPct > 65 ? 'warning.main' : 'success.main',
                  borderRadius: 4,
                },
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {formatBytes(stats.diskSpace.freeBytes)} free ({(100 - diskPct).toFixed(1)}%)
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Search + Table */}
      <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <CardContent sx={{ pb: 0 }}>
          <TextField
            size="small"
            placeholder="Search backups..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment>,
            }}
            sx={{ width: 280, mb: 2 }}
          />
        </CardContent>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Size</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Completed</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton variant="text" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : filtered.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                        No backups found
                      </TableCell>
                    </TableRow>
                  )
                  : filtered.map(b => {
                      let hasCloud = false;
                      try {
                        const cfg = JSON.parse(b.config || '{}');
                        if (cfg.cloudCredentialId || b.backupType === 'cloud' || b.type === 'cloud') {
                          hasCloud = true;
                        }
                      } catch (e) { hasCloud = false; }

                      return (
                        <TableRow key={b.id} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>{b.name}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 200, display: 'block' }}>
                              {b.destination}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip label={b.backupType || b.type} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell>
                            <Chip label={b.status} size="small" color={getStatusColor(b.status)} />
                          </TableCell>
                          <TableCell>{formatBytes(b.size)}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(b.createdAt)}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(b.completedAt)}</TableCell>
                          <TableCell align="right">
                            {hasCloud && (
                              <Tooltip title="S3 Version History">
                                <IconButton size="small" color="primary" onClick={() => handleOpenVersions(b)}>
                                  <HistoryIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title="Download">
                              <IconButton size="small" onClick={() => handleDownload(b.id)} disabled={b.status !== 'completed'}>
                                <DownloadIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                              <IconButton size="small" color="error" onClick={() => handleDelete(b.id, b.name)} disabled={deleting === b.id}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })
              }
            </TableBody>
          </Table>
        </TableContainer>
        {!loading && filtered.length > 0 && (
          <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary">
              Showing {filtered.length} of {backups.length} backups
            </Typography>
          </Box>
        )}
      </Card>

      {/* S3 Object Versions Dialog */}
      <Dialog open={versionDialogOpen} onClose={() => setVersionDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          S3 Object Versions — {selectedBackup?.name}
        </DialogTitle>
        <DialogContent dividers>
          {loadingVersions ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={30} />
            </Box>
          ) : versioningData?.error ? (
            <Box sx={{ py: 2 }}>
              <Typography color="error" variant="body2" sx={{ mb: 2 }}>
                {versioningData.error}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                Would you like to enable versioning for this storage bucket?
              </Typography>
              <Button variant="contained" color="primary" onClick={handleEnableVersioning}>
                Enable Bucket Versioning
              </Button>
            </Box>
          ) : (
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Status: {versioningData?.versioningStatus || 'Unknown'}
                </Typography>
                {!versioningData?.versioningEnabled && (
                  <Button size="small" variant="outlined" onClick={handleEnableVersioning}>
                    Enable Versioning
                  </Button>
                )}
              </Stack>
              <Divider sx={{ mb: 1.5 }} />
              <List sx={{ p: 0 }}>
                {(!versioningData?.versions || versioningData.versions.length === 0) ? (
                  <Typography color="text.secondary" sx={{ py: 2 }} align="center">
                    No S3 object versions found.
                  </Typography>
                ) : (
                  versioningData.versions.map((v, index) => (
                    <Box key={v.versionId || index}>
                      <ListItem sx={{ py: 1.5, px: 0 }}>
                        <ListItemText
                          primary={
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <Typography variant="body2" fontWeight={600}>
                                Version: {v.versionId === 'null' ? 'Null/Unversioned' : (v.versionId?.substring(0, 12) || '—')}
                              </Typography>
                              {v.isLatest && (
                                <Chip label="Latest" size="small" color="success" sx={{ height: 18, fontSize: 10 }} />
                              )}
                              {v.isDeleteMarker && (
                                <Chip label="Delete Marker" size="small" color="error" sx={{ height: 18, fontSize: 10 }} />
                              )}
                            </Stack>
                          }
                          secondary={
                            <Typography variant="caption" color="text.secondary">
                              Modified: {formatDate(v.lastModified)} {!v.isDeleteMarker && `· Size: ${formatBytes(v.size)}`}
                            </Typography>
                          }
                        />
                        {!v.isDeleteMarker && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<RestoreIcon />}
                            onClick={() => handleRestoreVersion(v.versionId)}
                          >
                            Restore
                          </Button>
                        )}
                      </ListItem>
                      {index < versioningData.versions.length - 1 && <Divider />}
                    </Box>
                  ))
                )}
              </List>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVersionDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
