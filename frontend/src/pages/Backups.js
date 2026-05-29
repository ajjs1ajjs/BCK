import { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
  InputAdornment, Checkbox,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  PlayArrow as RunIcon, Search as SearchIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';

import { API } from '../utils/config';
const EMPTY = { name: '', source: '', destination: '', type: 'full' };

const statusColor = {
  completed: 'success', failed: 'error', running: 'info',
  pending: 'warning', active: 'primary',
};

export default function Backups() {
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const filtered = backups.filter(b =>
    b.name?.toLowerCase().includes(search.toLowerCase()) ||
    b.source?.toLowerCase().includes(search.toLowerCase())
  );
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [selected, setSelected] = useState([]);
  const { can } = useAuth();
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/backups?limit=500`).then(r => r.json()).then(data => setBackups(data.data || data || [])).catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (b) => { setEditing(b); setForm({ name: b.name, source: b.source, destination: b.destination, type: b.type || 'full' }); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.name || !form.source || !form.destination) {
      setSnack({ open: true, msg: 'Name, source, and destination are required', severity: 'warning' });
      return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error('Request failed');
      setSnack({ open: true, msg: editing ? 'Backup updated' : 'Backup created', severity: 'success' });
      setDialogOpen(false);
      load();
    } catch {
      setSnack({ open: true, msg: 'Failed to save backup', severity: 'error' });
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' });
      setSnack({ open: true, msg: 'Backup deleted', severity: 'success' });
      setDeleteConfirm(null);
      load();
    } catch {
      setSnack({ open: true, msg: 'Failed to delete', severity: 'error' });
    }
  };

  const handleRun = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
      setSnack({ open: true, msg: 'Backup job started', severity: 'info' });
      setTimeout(load, 2000);
    } catch {
      setSnack({ open: true, msg: 'Failed to start backup', severity: 'error' });
    }
  };

  const isAllSelected = selected.length === filtered.length && filtered.length > 0;
  const toggleSelectAll = () => {
    if (isAllSelected) { setSelected([]); }
    else { setSelected(filtered.map(b => b.id)); }
  };
  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const bulkRun = async () => {
    for (const id of selected) {
      await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
    }
    setSnack({ open: true, msg: `Started ${selected.length} backup(s)`, severity: 'info' });
    setSelected([]);
    setTimeout(load, 3000);
  };

  const bulkDelete = async () => {
    for (const id of selected) {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' });
    }
    setSnack({ open: true, msg: `Deleted ${selected.length} backup(s)`, severity: 'success' });
    setSelected([]);
    setBulkConfirm(null);
    load();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">{t('backups')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          {t('newBackupBtn')}
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('allBackups')} — {backups.length} {t('totalJobs').toLowerCase()}
      </Typography>

      <Card>
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
            <TextField
              size="small" placeholder={`${t('search')}...`}
              value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: 1, maxWidth: 320 }}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              }}
            />
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>
              {t('refresh')}
            </Button>
          </Box>

          {selected.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, p: 1.5, bgcolor: 'rgba(124,58,237,0.06)', borderRadius: 2, border: '1px solid', borderColor: 'rgba(124,58,237,0.15)' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{selected.length} selected</Typography>
              <Button size="small" variant="contained" color="success" startIcon={<RunIcon />} onClick={bulkRun}>{t('runNow')}</Button>
              {can('delete') && <Button size="small" variant="contained" color="error" startIcon={<DeleteIcon />} onClick={() => setBulkConfirm(true)}>{t('delete')}</Button>}
              <Button size="small" variant="text" onClick={() => setSelected([])}>{t('cancel')}</Button>
            </Box>
          )}

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {can('delete') && (
                    <TableCell sx={{ fontWeight: 600, width: 40 }}>
                      <Checkbox size="small" checked={isAllSelected} indeterminate={selected.length > 0 && !isAllSelected} onChange={toggleSelectAll} />
                    </TableCell>
                  )}
                  <TableCell sx={{ fontWeight: 600 }}>{t('name')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('sourcePath')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('destPath')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('createdAt')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">{t('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={can('delete') ? 8 : 7} align="center" sx={{ py: 6 }}>
                      <Typography color="text.secondary">
                        {search ? t('noDataYet') : t('noBackupsConfigured')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((b) => (
                    <TableRow key={b.id} hover>
                      {can('delete') && (
                        <TableCell>
                          <Checkbox size="small" checked={selected.includes(b.id)} onChange={() => toggleSelect(b.id)} />
                        </TableCell>
                      )}
                      <TableCell>
                        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{b.name}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{b.source}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{b.destination}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={b.backupType || b.type} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={b.status || 'unknown'}
                          size="small"
                          color={statusColor[b.status] || 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12 }}>
                          {(b.createdAt || '').slice(0, 10)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title={t('runNow')}><IconButton size="small" onClick={() => handleRun(b.id)}><RunIcon fontSize="small" /></IconButton></Tooltip>
                        {can('manageBackups') && <><Tooltip title={t('edit')}><IconButton size="small" onClick={() => openEdit(b)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title={t('delete')}><IconButton size="small" onClick={() => setDeleteConfirm(b)}><DeleteIcon fontSize="small" /></IconButton></Tooltip></>}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? t('editBackup') : t('addBackup')}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField label={t('name')} fullWidth value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <TextField label={t('sourcePath')} fullWidth value={form.source} onChange={(e) => setForm({...form, source: e.target.value})} placeholder="/var/lib/mysql" />
            <TextField label={t('destPath')} fullWidth value={form.destination} onChange={(e) => setForm({...form, destination: e.target.value})} placeholder="/backup/db" />
            <TextField select label={t('type')} fullWidth value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
              <MenuItem value="full">Full</MenuItem>
              <MenuItem value="incremental">Incremental</MenuItem>
              <MenuItem value="differential">Differential</MenuItem>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={handleSave}>{editing ? t('save') : t('create')}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteConfirmDesc')} ("{deleteConfirm?.name}")</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => handleDelete(deleteConfirm.id)}>{t('delete')}</Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Delete Confirm */}
      <Dialog open={!!bulkConfirm} onClose={() => setBulkConfirm(null)} maxWidth="xs">
        <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteConfirmDesc')} ({selected.length} {t('backups').toLowerCase()})</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkConfirm(null)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" onClick={bulkDelete}>{t('delete')} {selected.length}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open} autoHideDuration={4000}
        onClose={() => setSnack({...snack, open: false})}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
