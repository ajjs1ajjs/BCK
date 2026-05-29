import { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, LinearProgress, Tooltip, alpha, IconButton, TextField,
  InputAdornment, Skeleton,
} from '@mui/material';
import {
  Storage as StorageIcon, Folder as FolderIcon, InsertDriveFile as FileIcon,
  Refresh as RefreshIcon, Download as DownloadIcon, Delete as DeleteIcon,
  Search as SearchIcon, CloudDone as CloudDoneIcon,
} from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';
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
  const { t } = useTranslation();
  const [backups, setBackups] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(null);

  const token = localStorage.getItem('token') || '';
  const headers = { Authorization: `Bearer ${token}` };

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
                  : filtered.map(b => (
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
                  ))
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
    </Box>
  );
}
