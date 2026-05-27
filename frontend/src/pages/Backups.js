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

const API = process.env.REACT_APP_API_URL || '';
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

  const load = useCallback(() => {
    fetch(`${API}/api/backups`).then(r => r.json()).then(setBackups).catch(() => {});
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

  // Bulk operations
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
        <Typography variant="h4">Backups</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          New Backup
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage backup jobs — {backups.length} total
      </Typography>

      <Card>
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
            <TextField
              size="small" placeholder="Search backups..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: 1, maxWidth: 320 }}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              }}
            />
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>
              Refresh
            </Button>
          </Box>

          {selected.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, p: 1.5, bgcolor: 'rgba(99,102,241,0.06)', borderRadius: 2, border: '1px solid', borderColor: 'rgba(99,102,241,0.15)' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{selected.length} selected</Typography>
              <Button size="small" variant="contained" color="success" startIcon={<RunIcon />} onClick={bulkRun}>Run All</Button>
              {can('delete') && <Button size="small" variant="contained" color="error" startIcon={<DeleteIcon />} onClick={() => setBulkConfirm(true)}>Delete All</Button>}
              <Button size="small" variant="text" onClick={() => setSelected([])}>Clear</Button>
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
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Source</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Destination</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={can('delete') ? 8 : 7} align="center" sx={{ py: 6 }}>
                      <Typography color="text.secondary">
                        {search ? 'No backups matching search' : 'No backups yet. Click "New Backup" to create one.'}
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
                        <Tooltip title="Run now"><IconButton size="small" onClick={() => handleRun(b.id)}><RunIcon fontSize="small" /></IconButton></Tooltip>
                        {can('manageBackups') && <><Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(b)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => setDeleteConfirm(b)}><DeleteIcon fontSize="small" /></IconButton></Tooltip></>}
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
        <DialogTitle>{editing ? 'Edit Backup' : 'New Backup'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField label="Name" fullWidth value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <TextField label="Source path" fullWidth value={form.source} onChange={(e) => setForm({...form, source: e.target.value})} placeholder="/var/lib/mysql" />
            <TextField label="Destination path" fullWidth value={form.destination} onChange={(e) => setForm({...form, destination: e.target.value})} placeholder="/backup/db" />
            <TextField select label="Type" fullWidth value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
              <MenuItem value="full">Full</MenuItem>
              <MenuItem value="incremental">Incremental</MenuItem>
              <MenuItem value="differential">Differential</MenuItem>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>Delete Backup</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete "{deleteConfirm?.name}"?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => handleDelete(deleteConfirm.id)}>Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Delete Confirm */}
      <Dialog open={!!bulkConfirm} onClose={() => setBulkConfirm(null)} maxWidth="xs">
        <DialogTitle>Bulk Delete</DialogTitle>
        <DialogContent>
          <Typography>Delete {selected.length} backup(s)? This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={bulkDelete}>Delete {selected.length}</Button>
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
