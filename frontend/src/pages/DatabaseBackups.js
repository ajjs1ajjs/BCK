import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
  Tabs, Tab, Switch, FormControlLabel,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  PlayArrow as RunIcon, Refresh as RefreshIcon, Link as LinkIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';

import { API } from '../utils/config';
const DB_TYPES = ['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'];

export default function DatabaseBackups() {
  const [tab, setTab] = useState(0);
  const [connections, setConnections] = useState([]);
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connDialog, setConnDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingConn, setEditingConn] = useState(null);
  const [form, setForm] = useState({ name: '', source: '', destination: '', type: 'mysql', config: { connectionId: '', database: '' } });
  const [connForm, setConnForm] = useState({ name: '', type: 'mysql', host: '', port: 3306, user: '', password: '', database: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const [cloudCreds, setCloudCreds] = useState([]);
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/db-connections`).then(r => r.json()).then(setConnections).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/backups?limit=500&type=db`).then(r => r.json()).then(data => {
      const b = data.data || data || [];
      setBackups(b.filter(x => ['mysql','postgres','oracle', 'mongodb', 'mssql', 'redis'].includes(x.backupType || x.type)));
    }).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/cloud-credentials`).then(r => r.json()).then(setCloudCreds).catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Connection dialog
  const openConnCreate = () => { setEditingConn(null); setConnForm({ name: '', type: 'mysql', host: '', port: 3306, user: '', password: '', database: '' }); setConnDialog(true); };
  const openConnEdit = (c) => { setEditingConn(c); setConnForm({ name: c.name, type: c.type, host: c.host, port: c.port, user: c.user, password: '', database: c.database }); setConnDialog(true); };

  const saveConn = async () => {
    if (!connForm.name || !connForm.host || !connForm.user) {
      setSnack({ open: true, msg: 'Name, host, and user required', severity: 'warning' }); return;
    }
    const method = editingConn ? 'PUT' : 'POST';
    const url = editingConn ? `${API}/api/db-connections/${editingConn.id}` : `${API}/api/db-connections`;
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(connForm) });
      if (!r.ok) throw new Error();
      setSnack({ open: true, msg: editingConn ? 'Connection updated' : 'Connection created', severity: 'success' });
      setConnDialog(false); load();
    } catch { setSnack({ open: true, msg: 'Failed to save', severity: 'error' }); }
  };

  const deleteConn = async (id) => {
    try { await fetch(`${API}/api/db-connections/${id}`, { method: 'DELETE' }); load(); }
    catch { setSnack({ open: true, msg: 'Failed to delete', severity: 'error' }); }
  };

  const testConn = async (id) => {
    try {
      const r = await fetch(`${API}/api/db-connections/${id}/test`, { method: 'POST' });
      const data = await r.json();
      setSnack({ open: true, msg: data.success ? `${t('connectionSuccess')}! ${data.databases?.length || 0} ${t('databasesFound').toLowerCase()}` : `${t('connectionFailed')}: ${data.error}`, severity: data.success ? 'success' : 'error' });
    } catch { setSnack({ open: true, msg: t('connectionFailed'), severity: 'error' }); }
  };

  // Backup dialog
  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', source: '', destination: '', type: 'mysql', config: { connectionId: '', database: '', encryption: false, encryptionPassword: '' } });
    setDialogOpen(true);
  };

  const openEdit = (b) => {
    setEditing(b);
    setForm({
      name: b.name || '',
      source: b.source || '',
      destination: b.destination || '',
      type: b.backupType || b.type || 'mysql',
      config: {
        connectionId: b.config?.connectionId || '',
        database: b.config?.database || '',
        cloudCredentialId: b.config?.cloudCredentialId || '',
        encryption: b.config?.encryption || false,
        encryptionPassword: b.config?.encryptionPassword || '',
      },
    });
    setDialogOpen(true);
  };

  const saveBackup = async () => {
    if (!form.name || !form.destination) {
      setSnack({ open: true, msg: 'Name and destination required', severity: 'warning' }); return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;
    try {
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, backupType: form.type, type: 'full', source: form.config.connectionId || form.source }),
      });
      if (!r.ok) throw new Error();
      setSnack({ open: true, msg: editing ? 'Backup updated' : 'Backup created', severity: 'success' });
      setDialogOpen(false); load();
    } catch { setSnack({ open: true, msg: 'Failed to save', severity: 'error' }); }
  };

  const runBackup = async (id) => {
    try {
      const r = await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
      const data = await r.json();
      setSnack({ open: true, msg: data.message, severity: 'info' });
      setTimeout(load, 2000);
    } catch { setSnack({ open: true, msg: 'Failed to start backup', severity: 'error' }); }
  };

  const deleteBackup = async (id) => {
    try { await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' }); load(); }
    catch { setSnack({ open: true, msg: 'Failed to delete', severity: 'error' }); }
  };

  const runAllBackups = async () => {
    const dbBackups = backups.filter(b => b.status !== 'running');
    for (const b of dbBackups) {
      await fetch(`${API}/api/backups/${b.id}/run`, { method: 'POST' });
    }
    setSnack({ open: true, msg: `Started ${dbBackups.length} backup(s)`, severity: 'info' });
    setTimeout(load, 3000);
  };

  const getConnName = (id) => connections.find(c => c.id === id)?.name || id?.slice(0, 8) || 'N/A';

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">{t('databases')}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<LinkIcon />} onClick={openConnCreate}>{t('addConnection')}</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('newBackupBtn')}</Button>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        MySQL &bull; PostgreSQL &bull; Oracle
      </Typography>

      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label={`${t('backups')} (${backups.length})`} />
        <Tab label={`${t('dbConnections')} (${connections.length})`} />
      </Tabs>

      {tab === 0 && (
        <Card>
          <CardContent sx={{ pb: '8px !important' }}>
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>{t('refresh')}</Button>
              {backups.filter(b => b.status !== 'running').length > 0 && (
                <Button variant="outlined" size="small" color="success" startIcon={<RunIcon />} onClick={runAllBackups}>{t('runNow')}</Button>
              )}
            </Box>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t('name')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('type')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('dbConnections')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('destPath')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('createdAt')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">{t('actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {backups.length === 0 ? (
                    <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6 }}><Typography color="text.secondary">{t('noBackupsConfigured')}</Typography></TableCell></TableRow>
                  ) : backups.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{b.name}</Typography></TableCell>
                      <TableCell><Chip label={b.backupType || b.type} size="small" color="primary" variant="outlined" /></TableCell>
                      <TableCell>{getConnName(b.config?.connectionId)}</TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{b.destination}</Typography></TableCell>
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
      )}

      {tab === 1 && (
        <Card>
          <CardContent>
            {connections.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <StorageIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1 }} />
                <Typography color="text.secondary">{t('noBackupsConfigured')}</Typography>
              </Box>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>{t('name')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('type')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('host')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('databases')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('username')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">{t('actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {connections.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell><Typography sx={{ fontWeight: 600 }}>{c.name}</Typography></TableCell>
                        <TableCell><Chip label={c.type} size="small" color="secondary" variant="outlined" /></TableCell>
                        <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{c.host}:{c.port}</Typography></TableCell>
                        <TableCell>{c.database || '—'}</TableCell>
                        <TableCell>{c.user}</TableCell>
                        <TableCell align="right">
                          <Tooltip title={t('testConnection')}><IconButton size="small" onClick={() => testConn(c.id)}><LinkIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title={t('edit')}><IconButton size="small" onClick={() => openConnEdit(c)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title={t('delete')}><IconButton size="small" onClick={() => deleteConn(c.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connection Dialog */}
      <Dialog open={connDialog} onClose={() => setConnDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingConn ? t('editConnection') : t('addConnection')}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label={t('name')} fullWidth value={connForm.name} onChange={(e) => setConnForm({...connForm, name: e.target.value})} />
            <TextField select label={t('type')} fullWidth value={connForm.type} onChange={(e) => {
              const type = e.target.value;
              let port = 3306;
              if (type === 'postgres') port = 5432;
              if (type === 'oracle') port = 1521;
              if (type === 'mongodb') port = 27017;
              if (type === 'mssql') port = 1433;
              if (type === 'redis') port = 6379;
              setConnForm({...connForm, type, port });
            }}>
              {DB_TYPES.map(t => <MenuItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</MenuItem>)}
            </TextField>
            <TextField label={t('host')} fullWidth value={connForm.host} onChange={(e) => setConnForm({...connForm, host: e.target.value})} />
            <TextField label={t('port')} type="number" fullWidth value={connForm.port} onChange={(e) => setConnForm({...connForm, port: parseInt(e.target.value)})} />
            <TextField label={t('databases')} fullWidth value={connForm.database} onChange={(e) => setConnForm({...connForm, database: e.target.value})} />
            <TextField label={t('username')} fullWidth value={connForm.user} onChange={(e) => setConnForm({...connForm, user: e.target.value})} />
            <TextField label={t('password')} type="password" fullWidth value={connForm.password} onChange={(e) => setConnForm({...connForm, password: e.target.value})} placeholder={editingConn ? 'Leave blank to keep current' : ''} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConnDialog(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={saveConn}>{editingConn ? t('save') : t('create')}</Button>
        </DialogActions>
      </Dialog>

      {/* Backup Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle>{editing ? t('editBackup') : t('addBackup')}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5, py: 0.5 }}>
            <TextField label={t('name')} fullWidth required value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="e.g. Monthly MySQL Dump" />
            <TextField select label={t('type')} fullWidth required value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
              {DB_TYPES.map(t => <MenuItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</MenuItem>)}
            </TextField>
            <TextField select label={t('dbConnections')} fullWidth required value={form.config.connectionId} onChange={(e) => setForm({...form, config: {...form.config, connectionId: e.target.value}})}>
              {connections.filter(c => c.type === form.type).map(c => (
                <MenuItem key={c.id} value={c.id}>{c.name} ({c.host}:{c.port})</MenuItem>
              ))}
              {connections.length === 0 && <MenuItem disabled value="">No connections — add one first</MenuItem>}
            </TextField>
            <TextField label={t('databases')} fullWidth value={form.config.database} onChange={(e) => setForm({...form, config: {...form.config, database: e.target.value}})} placeholder="e.g. my_app_db" />
            <TextField label={t('destPath')} fullWidth required value={form.destination} onChange={(e) => setForm({...form, destination: e.target.value})} placeholder="/backup/mysql" />
            <TextField label={t('sourcePath')} fullWidth value={form.source} onChange={(e) => setForm({...form, source: e.target.value})} placeholder="Optional: custom source path" />
            <TextField select label="Upload to Cloud (optional)" fullWidth value={form.config.cloudCredentialId || ''} onChange={(e) => setForm({...form, config: {...form.config, cloudCredentialId: e.target.value}})}>
              <MenuItem value="">None — local only</MenuItem>
              {cloudCreds.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.provider})</MenuItem>)}
            </TextField>
            <FormControlLabel
              control={<Switch checked={form.config.encryption || false} onChange={(e) => setForm({...form, config: {...form.config, encryption: e.target.checked}})} />}
              label="Encrypt Backup File (AES-256)"
            />
            {form.config.encryption && (
              <TextField
                label="Encryption Password"
                type="password"
                fullWidth
                required
                value={form.config.encryptionPassword || ''}
                onChange={(e) => setForm({...form, config: {...form.config, encryptionPassword: e.target.value}})}
                placeholder="Enter password to encrypt/decrypt backup"
              />
            )}
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
