import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, PlayArrow as RunIcon,
  Refresh as RefreshIcon, Computer as SshIcon, Edit as EditIcon,
} from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';

const API = process.env.REACT_APP_API_URL || '';

const EMPTY_FORM = {
  name: '', destination: '/backup/ssh', backupType: 'ssh',
  config: { sshConnectionId: '', sourcePath: '/', excludes: '/dev\n/proc\n/sys\n/run\n/tmp', cloudCredentialId: '' },
};

export default function SshBackups() {
  const [backups, setBackups] = useState([]);
  const [sshConns, setSshConns] = useState([]);
  const [cloudCreds, setCloudCreds] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connDialogOpen, setConnDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [connForm, setConnForm] = useState({ name: '', host: '', port: 22, user: '', password: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { t, lang } = useTranslation();
  const isUk = lang === 'uk';

  const load = useCallback(() => {
    fetch(`${API}/api/backups?type=ssh`).then(r => r.json()).then(setBackups).catch(() => {});
    fetch(`${API}/api/ssh-connections`).then(r => r.json()).then(setSshConns).catch(() => {});
    fetch(`${API}/api/cloud-credentials`).then(r => r.json()).then(setCloudCreds).catch(() => {});
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
      destination: backup.destination || '/backup/ssh',
      backupType: backup.backupType || 'ssh',
      config: { ...EMPTY_FORM.config, ...backup.config, sourcePath: backup.config?.sourcePath || backup.source || '/' },
    });
    setDialogOpen(true);
  };

  const saveBackup = async () => {
    if (!form.name || !form.config.sshConnectionId || !form.destination) {
      setSnack({ open: true, msg: isUk ? 'Назва, SSH зʼєднання і сховище обовʼязкові' : 'Name, SSH connection, and destination required', severity: 'warning' });
      return;
    }

    const excludes = (form.config.excludes || '').split('\n').map(s => s.trim()).filter(Boolean);
    const payload = {
      name: form.name,
      source: form.config.sourcePath || '/',
      destination: form.destination,
      type: 'full',
      backupType: form.backupType,
      config: { ...form.config, excludes },
    };

    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;

    try {
      const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (resp.ok) {
        setSnack({ open: true, msg: isUk ? 'Збережено' : 'Saved', severity: 'success' });
        setDialogOpen(false);
        load();
      } else {
        const err = await resp.json();
        setSnack({ open: true, msg: err.error || 'Error', severity: 'error' });
      }
    } catch { setSnack({ open: true, msg: 'Network error', severity: 'error' }); }
  };

  const runBackup = async (id) => {
    try {
      const resp = await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
      const data = await resp.json();
      setSnack({ open: true, msg: data.message || 'Started', severity: 'success' });
      load();
    } catch { setSnack({ open: true, msg: 'Error', severity: 'error' }); }
  };

  const deleteBackup = async (id) => {
    if (!confirm(isUk ? 'Видалити?' : 'Delete?')) return;
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' });
      setSnack({ open: true, msg: isUk ? 'Видалено' : 'Deleted', severity: 'success' });
      load();
    } catch { setSnack({ open: true, msg: 'Error', severity: 'error' }); }
  };

  const saveConnection = async () => {
    if (!connForm.name || !connForm.host || !connForm.user) return;
    try {
      const resp = await fetch(`${API}/api/ssh-connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(connForm) });
      if (resp.ok) {
        setConnDialogOpen(false);
        setConnForm({ name: '', host: '', port: 22, user: '', password: '' });
        load();
      }
    } catch {}
  };

  const deleteConnection = async (id) => {
    try { await fetch(`${API}/api/ssh-connections/${id}`, { method: 'DELETE' }); load(); } catch {}
  };

  const testConnection = async (id) => {
    try {
      const resp = await fetch(`${API}/api/ssh-connections/${id}/test`, { method: 'POST' });
      const data = await resp.json();
      setSnack({ open: true, msg: data.success ? (isUk ? `Підключено до ${data.hostname}` : `Connected to ${data.hostname}`) : (data.error || 'Failed'), severity: data.success ? 'success' : 'error' });
    } catch {}
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:2, mb:3 }}>
        <Typography variant="h5" sx={{ fontWeight:700, color:'#fff' }}>{isUk ? 'SSH бекапи' : 'SSH Backups'}</Typography>
        <Box sx={{ display:'flex', gap:1 }}>
          <Button onClick={() => setConnDialogOpen(true)} startIcon={<SshIcon />} sx={{ borderRadius:'30px', px:2.5, textTransform:'none', bgcolor:'rgba(139,92,246,0.15)', color:'#8b5cf6', '&:hover':{bgcolor:'rgba(139,92,246,0.25)'} }}>
            {isUk ? 'Додати з\'єднання' : 'Add SSH Connection'}
          </Button>
          <Button onClick={openCreate} startIcon={<AddIcon />} sx={{ borderRadius:'30px', px:2.5, textTransform:'none' }} variant="contained">
            {isUk ? 'Створити' : 'Create'}
          </Button>
        </Box>
      </Box>

      {/* SSH Connections */}
      <Card sx={{ mb: 3, borderRadius:'16px', border:'1px solid rgba(148,163,184,0.16)', background:'linear-gradient(145deg, rgba(15,23,42,0.72), rgba(12,18,30,0.82))' }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight:700, color:'#fff', mb:2 }}>{isUk ? 'SSH з\'єднання' : 'SSH Connections'}</Typography>
          {sshConns.length === 0 ? (
            <Typography variant="body2" sx={{ color:'rgba(255,255,255,0.3)' }}>{isUk ? 'Немає з\'єднань. Додайте нове.' : 'No connections. Add one.'}</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>{t('name')}</TableCell>
                    <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>Host</TableCell>
                    <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>User</TableCell>
                    <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>Port</TableCell>
                    <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>{t('actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sshConns.map(c => (
                    <TableRow key={c.id} sx={{ '&:hover':{bgcolor:'rgba(255,255,255,0.02)'} }}>
                      <TableCell sx={{ color:'#fff', fontSize:13 }}>{c.name}</TableCell>
                      <TableCell sx={{ color:'rgba(255,255,255,0.7)', fontSize:13 }}>{c.host}</TableCell>
                      <TableCell sx={{ color:'rgba(255,255,255,0.7)', fontSize:13 }}>{c.user}</TableCell>
                      <TableCell sx={{ color:'rgba(255,255,255,0.7)', fontSize:13 }}>{c.port}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => testConnection(c.id)} sx={{ color:'#22c55e', fontSize:12 }} title="Test">
                          <RunIcon sx={{ fontSize:16 }} />
                        </IconButton>
                        <IconButton size="small" onClick={() => deleteConnection(c.id)} sx={{ color:'#f43f5e', fontSize:12 }}>
                          <DeleteIcon sx={{ fontSize:16 }} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Backups Table */}
      <Card sx={{ borderRadius:'16px', border:'1px solid rgba(148,163,184,0.16)', background:'linear-gradient(145deg, rgba(15,23,42,0.72), rgba(12,18,30,0.82))' }}>
        <CardContent sx={{ p: 3 }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>{t('name')}</TableCell>
                  <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>SSH</TableCell>
                  <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>{t('status')}</TableCell>
                  <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>{t('created')}</TableCell>
                  <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:11 }}>{t('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.map(b => (
                  <TableRow key={b.id} sx={{ '&:hover':{bgcolor:'rgba(255,255,255,0.02)'} }}>
                    <TableCell sx={{ color:'#fff', fontSize:13 }}>{b.name}</TableCell>
                    <TableCell>
                      <Chip label={b.config?.sshConnectionId ? sshConns.find(c => c.id === b.config.sshConnectionId)?.name || 'SSH' : 'SSH'} size="small" sx={{ height:20, fontSize:10, bgcolor:'rgba(139,92,246,0.15)', color:'#8b5cf6' }} />
                    </TableCell>
                    <TableCell>
                      <Chip label={b.status} size="small" sx={{ height:20, fontSize:10, bgcolor: b.status === 'completed' ? 'rgba(34,197,94,0.15)' : b.status === 'failed' ? 'rgba(244,63,94,0.15)' : 'rgba(251,191,36,0.15)', color: b.status === 'completed' ? '#22c55e' : b.status === 'failed' ? '#f43f5e' : '#f59e0b' }} />
                    </TableCell>
                    <TableCell sx={{ color:'rgba(255,255,255,0.5)', fontSize:12 }}>{b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => runBackup(b.id)} sx={{ color:'#22c55e' }} title={t('run')}><RunIcon sx={{ fontSize:16 }} /></IconButton>
                      <IconButton size="small" onClick={() => openEdit(b)} sx={{ color:'#38bdf8' }}><EditIcon sx={{ fontSize:16 }} /></IconButton>
                      <IconButton size="small" onClick={() => deleteBackup(b.id)} sx={{ color:'#f43f5e' }}><DeleteIcon sx={{ fontSize:16 }} /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create/Edit Backup Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? t('editBackup') : t('addBackup')}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt:1, display:'flex', flexDirection:'column', gap:2.5 }}>
            <TextField label={t('name')} fullWidth value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            <TextField select label="SSH Connection" fullWidth required value={form.config.sshConnectionId} onChange={e => setForm({...form, config: {...form.config, sshConnectionId: e.target.value}})}>
              {sshConns.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.user}@{c.host})</MenuItem>)}
              {sshConns.length === 0 && <MenuItem disabled value="">No connections</MenuItem>}
            </TextField>
            <TextField select label={isUk ? 'Тип бекапу' : 'Backup Type'} fullWidth value={form.backupType} onChange={e => setForm({...form, backupType: e.target.value})}>
              <MenuItem value="ssh">{isUk ? 'Файлова система (tar)' : 'Filesystem (tar)'}</MenuItem>
              <MenuItem value="ssh-db">{isUk ? 'База даних (віддалено)' : 'Database (remote)'}</MenuItem>
            </TextField>
            {form.backupType === 'ssh-db' ? (
              <>
                <TextField select label={isUk ? 'Тип БД' : 'DB Type'} fullWidth value={form.config.dbType || 'mysql'} onChange={e => setForm({...form, config: {...form.config, dbType: e.target.value}})}>
                  <MenuItem value="mysql">MySQL</MenuItem>
                  <MenuItem value="postgres">PostgreSQL</MenuItem>
                </TextField>
                <TextField label={isUk ? 'База даних' : 'Database'} fullWidth value={form.config.database || ''} onChange={e => setForm({...form, config: {...form.config, database: e.target.value}})} placeholder="my_db" />
                <TextField label={isUk ? 'Хост БД' : 'DB Host'} fullWidth value={form.config.dbHost || 'localhost'} onChange={e => setForm({...form, config: {...form.config, dbHost: e.target.value}})} />
                <TextField label={isUk ? 'Порт БД' : 'DB Port'} type="number" fullWidth value={form.config.dbPort || ''} onChange={e => setForm({...form, config: {...form.config, dbPort: e.target.value}})} />
                <TextField label={isUk ? 'Користувач БД' : 'DB User'} fullWidth value={form.config.dbUser || ''} onChange={e => setForm({...form, config: {...form.config, dbUser: e.target.value}})} />
                <TextField label={isUk ? 'Пароль БД' : 'DB Password'} type="password" fullWidth value={form.config.dbPassword || ''} onChange={e => setForm({...form, config: {...form.config, dbPassword: e.target.value}})} />
              </>
            ) : (
              <>
                <TextField label={isUk ? 'Шлях на віддаленому сервері' : 'Remote Source Path'} fullWidth value={form.config.sourcePath} onChange={e => setForm({...form, config: {...form.config, sourcePath: e.target.value}})} placeholder="/" />
                <TextField label={isUk ? 'Виключення (по одному на рядок)' : 'Excludes (one per line)'} multiline rows={3} fullWidth value={form.config.excludes} onChange={e => setForm({...form, config: {...form.config, excludes: e.target.value}})} />
              </>
            )}
            <TextField label={isUk ? 'Сховище (локальна тека)' : 'Destination (local path)'} fullWidth required value={form.destination} onChange={e => setForm({...form, destination: e.target.value})} placeholder="/backup/ssh" />
            <TextField select label={isUk ? 'Завантажити в хмару (опціонально)' : 'Upload to Cloud (optional)'} fullWidth value={form.config.cloudCredentialId || ''} onChange={e => setForm({...form, config: {...form.config, cloudCredentialId: e.target.value}})}>
              <MenuItem value="">{isUk ? 'Ні — тільки локально' : 'None — local only'}</MenuItem>
              {cloudCreds.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.provider})</MenuItem>)}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
          <Button onClick={saveBackup} variant="contained">{editing ? t('save') : t('create')}</Button>
        </DialogActions>
      </Dialog>

      {/* SSH Connection Dialog */}
      <Dialog open={connDialogOpen} onClose={() => setConnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{isUk ? 'Нове SSH з\'єднання' : 'New SSH Connection'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt:1, display:'flex', flexDirection:'column', gap:2 }}>
            <TextField label={t('name')} fullWidth value={connForm.name} onChange={e => setConnForm({...connForm, name: e.target.value})} placeholder="My Server" />
            <TextField label="Host" fullWidth value={connForm.host} onChange={e => setConnForm({...connForm, host: e.target.value})} placeholder="192.168.1.100" />
            <TextField label="Port" type="number" fullWidth value={connForm.port} onChange={e => setConnForm({...connForm, port: parseInt(e.target.value) || 22})} />
            <TextField label="User" fullWidth value={connForm.user} onChange={e => setConnForm({...connForm, user: e.target.value})} placeholder="root" />
            <TextField label={isUk ? 'Пароль (або ключ через ssh-agent)' : 'Password (or use ssh-agent key)'} type="password" fullWidth value={connForm.password} onChange={e => setConnForm({...connForm, password: e.target.value})} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConnDialogOpen(false)}>{t('cancel')}</Button>
          <Button onClick={saveConnection} variant="contained">{isUk ? 'Додати' : 'Add'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical:'bottom', horizontal:'center' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ width:'100%' }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
