import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, PlayArrow as RunIcon,
  Refresh as RefreshIcon, Computer as ComputerIcon,
} from '@mui/icons-material';

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

  const saveBackup = async () => {
    if (!form.name || !form.config.vmName || !form.config.host) {
      setSnack({ open: true, msg: 'Name, VM name, and host required', severity: 'warning' }); return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;
    try {
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, backupType: form.type, type: 'full', source: form.config.host }),
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
        <Typography variant="h4">VM Backups</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New VM Backup</Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        VMware vSphere &bull; Microsoft Hyper-V virtual machine backup
      </Typography>

      <Card>
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
          </Box>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Platform</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>VM Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Host</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <ComputerIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1, display: 'block', mx: 'auto' }} />
                    <Typography color="text.secondary">No VM backups configured</Typography>
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
                      <Tooltip title="Run now"><IconButton size="small" onClick={() => runBackup(b.id)}><RunIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => deleteBackup(b.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit VM Backup' : 'New VM Backup'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField label="Backup Name" fullWidth value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <TextField select label="Platform" fullWidth value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
              <MenuItem value="vmware">VMware vSphere</MenuItem>
              <MenuItem value="hyperv">Microsoft Hyper-V</MenuItem>
            </TextField>
            <TextField label="VM Name" fullWidth value={form.config.vmName} onChange={(e) => setForm({...form, config: {...form.config, vmName: e.target.value}})} placeholder="my-vm" />
            <TextField label="Host / vCenter / Hyper-V Server" fullWidth value={form.config.host} onChange={(e) => setForm({...form, config: {...form.config, host: e.target.value}})} placeholder="vcenter.local or hyperv-server" />
            <TextField label="Username" fullWidth value={form.config.user} onChange={(e) => setForm({...form, config: {...form.config, user: e.target.value}})} />
            <TextField label="Password" type="password" fullWidth value={form.config.password} onChange={(e) => setForm({...form, config: {...form.config, password: e.target.value}})} />
            <TextField label="Datastore / Path" fullWidth value={form.config.datastore} onChange={(e) => setForm({...form, config: {...form.config, datastore: e.target.value}})} placeholder="datastore1 or D:\Hyper-V" />
            <TextField label="Backup Destination" fullWidth value={form.destination} onChange={(e) => setForm({...form, destination: e.target.value})} placeholder="/backup/vm" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveBackup}>{editing ? 'Update' : 'Create'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
