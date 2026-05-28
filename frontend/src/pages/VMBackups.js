import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, PlayArrow as RunIcon,
  Refresh as RefreshIcon, Computer as ComputerIcon, Edit as EditIcon,
} from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';

const API = process.env.REACT_APP_API_URL || '';
export default function VMBackups() {
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '', destination: '', type: 'vmware',
    config: { vmName: '', host: '', user: '', password: '', datastore: '' },
  });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/backups?type=vm`).then(r => r.json()).then(b => {
      setBackups(b.filter(x => ['vmware', 'hyperv'].includes(x.backupType || x.type)));
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', destination: '', type: 'vmware', config: { vmName: '', host: '', user: '', password: '', datastore: '' } });
    setDialogOpen(true);
  };

  const openEdit = (b) => {
    setEditing(b);
    setForm({
      name: b.name,
      destination: b.destination,
      type: b.backupType || b.type || 'vmware',
      config: {
        vmName: b.config?.vmName || '',
        host: b.config?.host || '',
        user: b.config?.user || '',
        password: '',
        datastore: b.config?.datastore || '',
      },
    });
    setDialogOpen(true);
  };

  const saveBackup = async () => {
    if (!form.name || !form.config.vmName || !form.config.host) {
      setSnack({ open: true, msg: 'Name, VM name, and host required', severity: 'warning' }); return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;
    
    const payload = { ...form, backupType: form.type, type: 'full', source: form.config.host };
    if (editing && !form.config.password) {
      payload.config.password = editing.config?.password || '';
    }

    try {
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error();
      setSnack({ open: true, msg: editing ? 'Backup updated' : 'Backup created', severity: 'success' });
      setDialogOpen(false); load();
    } catch { setSnack({ open: true, msg: 'Failed to save', severity: 'error' }); }
  };

  const runBackup = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
      setSnack({ open: true, msg: 'VM backup started', severity: 'info' });
      setTimeout(load, 2000);
    } catch { setSnack({ open: true, msg: 'Failed to start', severity: 'error' }); }
  };

  const deleteBackup = async (id) => {
    try { await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' }); load(); }
    catch { setSnack({ open: true, msg: 'Failed to delete', severity: 'error' }); }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">{t('vms')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('newBackupBtn')}</Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        VMware vSphere &bull; Microsoft Hyper-V
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
                  <TableCell sx={{ fontWeight: 600 }}>{t('provider')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('vmName')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('host')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('createdAt')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">{t('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <ComputerIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1, display: 'block', mx: 'auto' }} />
                    <Typography color="text.secondary">{t('noBackupsConfigured')}</Typography>
                  </TableCell></TableRow>
                ) : backups.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{b.name}</Typography></TableCell>
                    <TableCell><Chip label={b.backupType || b.type} size="small" color="primary" variant="outlined" /></TableCell>
                    <TableCell>{b.config?.vmName || '—'}</TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{b.config?.host || '—'}</Typography></TableCell>
                    <TableCell>
                      <Chip label={b.status} size="small" color={b.status === 'completed' ? 'success' : b.status === 'failed' ? 'error' : b.status === 'running' ? 'info' : 'default'} />
                    </TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{(b.createdAt || '').slice(0, 10)}</Typography></TableCell>
                    <TableCell align="right">
                      <Tooltip title={t('runNow')}><IconButton size="small" onClick={() => runBackup(b.id)}><RunIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title={t('edit')}><IconButton size="small" onClick={() => openEdit(b)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title={t('delete')}><IconButton size="small" onClick={() => deleteBackup(b.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? t('editBackup') : t('addBackup')}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField label={t('name')} fullWidth value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <TextField select label={t('provider')} fullWidth value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
              <MenuItem value="vmware">VMware vSphere</MenuItem>
              <MenuItem value="hyperv">Microsoft Hyper-V</MenuItem>
            </TextField>
            <TextField label={t('vmName')} fullWidth value={form.config.vmName} onChange={(e) => setForm({...form, config: {...form.config, vmName: e.target.value}})} placeholder="my-vm" />
            <TextField label={t('host')} fullWidth value={form.config.host} onChange={(e) => setForm({...form, config: {...form.config, host: e.target.value}})} placeholder="vcenter.local or hyperv-server" />
            <TextField label={t('username')} fullWidth value={form.config.user} onChange={(e) => setForm({...form, config: {...form.config, user: e.target.value}})} />
            <TextField label={t('password')} type="password" fullWidth value={form.config.password} onChange={(e) => setForm({...form, config: {...form.config, password: e.target.value}})} />
            <TextField label={t('datastore')} fullWidth value={form.config.datastore} onChange={(e) => setForm({...form, config: {...form.config, datastore: e.target.value}})} placeholder="datastore1 or D:\Hyper-V" />
            <TextField label={t('destPath')} fullWidth value={form.destination} onChange={(e) => setForm({...form, destination: e.target.value})} placeholder="/backup/vm" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={saveBackup}>{editing ? t('save') : t('create')}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
