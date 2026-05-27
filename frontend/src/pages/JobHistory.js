import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, TextField, MenuItem, Snackbar, Alert,
  InputAdornment, IconButton, Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon, Search as SearchIcon, FilterList as FilterIcon,
  Delete as DeleteIcon, CheckCircle as SuccessIcon, Error as ErrorIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || '';

export default function JobHistory() {
  const [backups, setBackups] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { can } = useAuth();

  const load = useCallback(() => {
    fetch(`${API}/api/backups`).then(r => r.json()).then(setBackups).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = backups.filter(b => {
    if (filter === 'completed' && b.status !== 'completed') return false;
    if (filter === 'failed' && b.status !== 'failed') return false;
    if (filter === 'running' && b.status !== 'running') return false;
    if (search && !b.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const deleteBackup = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' });
      load();
      setSnack({ open: true, msg: 'Deleted', severity: 'success' });
    } catch {
      setSnack({ open: true, msg: 'Delete failed', severity: 'error' });
    }
  };

  const getDuration = (b) => {
    if (!b.startedAt || !b.completedAt) return '—';
    const ms = new Date(b.completedAt) - new Date(b.startedAt);
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>Job History</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Recent backup job executions — {backups.length} total jobs
      </Typography>

      <Card>
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <TextField
              select size="small" value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ minWidth: 140 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><FilterIcon fontSize="small" /></InputAdornment> }}
            >
              <MenuItem value="all">All statuses</MenuItem>
              <MenuItem value="completed">Completed</MenuItem>
              <MenuItem value="running">Running</MenuItem>
              <MenuItem value="failed">Failed</MenuItem>
            </TextField>
            <TextField
              size="small" placeholder="Search jobs..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: 1, maxWidth: 300 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Job Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Started</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Duration</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Size</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Result</TableCell>
                  {can('delete') && <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={can('delete') ? 8 : 7} align="center" sx={{ py: 6 }}>
                    <Typography color="text.secondary">No job history found</Typography>
                  </TableCell></TableRow>
                ) : filtered.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{b.name}</Typography></TableCell>
                    <TableCell><Chip label={b.backupType || b.type} size="small" variant="outlined" /></TableCell>
                    <TableCell>
                      <Chip
                        label={b.status}
                        size="small"
                        color={b.status === 'completed' ? 'success' : b.status === 'failed' ? 'error' : b.status === 'running' ? 'info' : 'default'}
                        icon={b.status === 'completed' ? <SuccessIcon /> : b.status === 'failed' ? <ErrorIcon /> : null}
                      />
                    </TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{(b.startedAt || b.createdAt || '').slice(0, 19).replace('T', ' ')}</Typography></TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{getDuration(b)}</Typography></TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>
                        {b.resultFile ? `${(b.size || 0) > 0 ? (b.size / 1024 / 1024).toFixed(1) + ' MB' : '—'}` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {b.error ? (
                        <Tooltip title={b.error}>
                          <Chip label="Error" size="small" color="error" variant="outlined" />
                        </Tooltip>
                      ) : b.status === 'completed' ? (
                        <Chip label="OK" size="small" color="success" variant="outlined" />
                      ) : '—'}
                    </TableCell>
                    {can('delete') && (
                      <TableCell align="right">
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => deleteBackup(b.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
