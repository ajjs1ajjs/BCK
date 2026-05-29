import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, Snackbar, Alert,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, PlayArrow as RunIcon,
  Refresh as RefreshIcon, Dns as HostIcon, Edit as EditIcon,
} from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';

import { API } from '../utils/config';

const EMPTY_FORM = {
  name: '',
  sourcePath: '/',
  destination: '/backup/hosts',
  excludes: '/dev\n/proc\n/sys\n/run\n/tmp\n/mnt\n/media',
};

export default function HostBackups() {
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { t, lang } = useTranslation();
  const isUk = lang === 'uk';

  const load = useCallback(() => {
    fetch(`${API}/api/backups?type=host`)
      .then(r => r.json())
      .then(data => setBackups(data?.data || (Array.isArray(data) ? data : [])))
      .catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (backup) => {
    setEditing(backup);
    setForm({
      name: backup.name || '',
      sourcePath: backup.config?.sourcePath || backup.source || '/',
      destination: backup.destination || '/backup/hosts',
      excludes: (backup.config?.excludes || []).join('\n'),
    });
    setDialogOpen(true);
  };

  const saveBackup = async () => {
    if (!form.name || !form.sourcePath || !form.destination) {
      setSnack({ open: true, msg: isUk ? 'Назва, шлях хоста і сховище обовʼязкові' : 'Name, host path, and destination are required', severity: 'warning' });
      return;
    }

    const excludes = form.excludes.split('\n').map(item => item.trim()).filter(Boolean);
    const payload = {
      name: form.name,
      source: form.sourcePath,
      destination: form.destination,
      type: 'full',
      backupType: 'host',
      config: { sourcePath: form.sourcePath, excludes },
    };

    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error();
      setSnack({ open: true, msg: editing ? (isUk ? 'Копіювання хоста оновлено' : 'Host backup updated') : (isUk ? 'Копіювання хоста створено' : 'Host backup created'), severity: 'success' });
      setDialogOpen(false);
      load();
    } catch {
      setSnack({ open: true, msg: isUk ? 'Не вдалося зберегти backup хоста' : 'Failed to save host backup', severity: 'error' });
    }
  };

  const runBackup = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
      setSnack({ open: true, msg: isUk ? 'Копіювання хоста запущено' : 'Host backup started', severity: 'info' });
      setTimeout(load, 2000);
    } catch {
      setSnack({ open: true, msg: isUk ? 'Не вдалося запустити копіювання' : 'Failed to start backup', severity: 'error' });
    }
  };

  const deleteBackup = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' });
      load();
    } catch {
      setSnack({ open: true, msg: isUk ? 'Не вдалося видалити' : 'Failed to delete', severity: 'error' });
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">{isUk ? 'Хости' : 'Hosts'}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          {isUk ? 'Нове копіювання хоста' : 'New Host Backup'}
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {isUk ? 'Повне файлове копіювання хоста через tar-архів' : 'Full host file backup using tar archives'}
      </Typography>

      <Card>
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>{t('refresh')}</Button>
          </Box>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t('name')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{isUk ? 'Шлях хоста' : 'Host path'}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('destPath')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('createdAt')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">{t('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <HostIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1, display: 'block', mx: 'auto' }} />
                      <Typography color="text.secondary">{isUk ? 'Копіювання хостів ще не налаштоване' : 'No host backups configured'}</Typography>
                    </TableCell>
                  </TableRow>
                ) : backups.map((backup) => (
                  <TableRow key={backup.id}>
                    <TableCell><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{backup.name}</Typography></TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{backup.config?.sourcePath || backup.source}</Typography></TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{backup.destination}</Typography></TableCell>
                    <TableCell>
                      <Chip label={backup.status} size="small" color={backup.status === 'completed' ? 'success' : backup.status === 'failed' ? 'error' : backup.status === 'running' ? 'info' : 'default'} />
                    </TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{(backup.createdAt || '').slice(0, 10)}</Typography></TableCell>
                    <TableCell align="right">
                      <Tooltip title={t('runNow')}><IconButton size="small" onClick={() => runBackup(backup.id)}><RunIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title={t('edit')}><IconButton size="small" onClick={() => openEdit(backup)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title={t('delete')}><IconButton size="small" onClick={() => deleteBackup(backup.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? (isUk ? 'Редагувати копіювання хоста' : 'Edit Host Backup') : (isUk ? 'Додати копіювання хоста' : 'Add Host Backup')}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField label={t('name')} fullWidth value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField
              label={isUk ? 'Що копіювати на хості' : 'Host path to back up'}
              fullWidth
              value={form.sourcePath}
              onChange={(e) => setForm({ ...form, sourcePath: e.target.value })}
              placeholder="/"
              helperText={isUk ? 'Для цілого хоста використовуйте /. Системні каталоги виключаються нижче.' : 'Use / for the whole host. System folders are excluded below.'}
            />
            <TextField label={t('destPath')} fullWidth value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="/backup/hosts" />
            <TextField
              label={isUk ? 'Виключити з копії' : 'Exclude from backup'}
              fullWidth
              multiline
              rows={5}
              value={form.excludes}
              onChange={(e) => setForm({ ...form, excludes: e.target.value })}
              helperText={isUk ? 'Один шлях на рядок. Наприклад: /proc, /sys, /tmp.' : 'One path per line. Example: /proc, /sys, /tmp.'}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={saveBackup}>{editing ? t('save') : t('create')}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
