import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, TextField, MenuItem, Snackbar, Alert,
  InputAdornment, IconButton, Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon, Search as SearchIcon, FilterList as FilterIcon,
  Delete as DeleteIcon, CheckCircle as SuccessIcon, Error as ErrorIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';

import { API } from '../utils/config';

export default function JobHistory() {
  const [backups, setBackups] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { can } = useAuth();
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/backups`)
      .then(r => r.json())
      .then(data => setBackups(data?.data || (Array.isArray(data) ? data : [])))
      .catch(e => console.error('Load error:', e));
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
      setSnack({ open: true, msg: t('deleted'), severity: 'success' });
    } catch {
      setSnack({ open: true, msg: t('deleteFailed'), severity: 'error' });
    }
  };

  const downloadBackupFile = async (b) => {
    try {
      const r = await fetch(`${API}/api/backups/${b.id}/download`);
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || 'Download failed');
      }
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      let filename = b.resultFile ? b.resultFile.split(/[/\\]/).pop() : `backup_${b.id}.zip`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setSnack({ open: true, msg: `Failed to download: ${e.message}`, severity: 'error' });
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
      <Typography variant="h4" sx={{ mb: 0.5 }}>{t('history')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('jobHistorySubtitle', { total: backups.length })}
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
              <MenuItem value="all">{t('allStatuses')}</MenuItem>
              <MenuItem value="completed">{t('completed')}</MenuItem>
              <MenuItem value="running">{t('running')}</MenuItem>
              <MenuItem value="failed">{t('failed')}</MenuItem>
            </TextField>
            <TextField
              size="small" placeholder={t('searchJobs')}
              value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: 1, maxWidth: 300 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>{t('refresh')}</Button>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t('jobName')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('started')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('duration')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('size')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('result')}</TableCell>
                  {(can('delete') || can('restore')) && <TableCell sx={{ fontWeight: 600 }} align="right">{t('actions')}</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={can('delete') ? 8 : 7} align="center" sx={{ py: 6 }}>
                    <Typography color="text.secondary">{t('noJobHistory')}</Typography>
                  </TableCell></TableRow>
                ) : filtered.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{b.name}</Typography></TableCell>
                    <TableCell><Chip label={b.backupType || b.type} size="small" variant="outlined" /></TableCell>
                    <TableCell>
                      <Chip
                        label={t(b.status)}
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
                          <Chip label={t('error')} size="small" color="error" variant="outlined" />
                        </Tooltip>
                      ) : b.status === 'completed' ? (
                        <Chip label="OK" size="small" color="success" variant="outlined" />
                      ) : '—'}
                    </TableCell>
                    {(can('delete') || can('restore')) && (
                      <TableCell align="right">
                        {can('restore') && b.status === 'completed' && b.resultFile && (
                          <Tooltip title={t('download')}>
                            <IconButton size="small" onClick={() => downloadBackupFile(b)}>
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {can('delete') && (
                          <Tooltip title={t('delete')}><IconButton size="small" onClick={() => deleteBackup(b.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                        )}
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
