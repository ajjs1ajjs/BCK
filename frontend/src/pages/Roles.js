import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, Switch, FormControlLabel,
  Snackbar, Alert,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  Refresh as RefreshIcon, Security as SecurityIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || '';

const defaultPermissions = {
  manageUsers: false, manageBackups: true, manageSchedules: true,
  restore: true, delete: false, configure: false, viewLogs: true, manageRoles: false,
};

const permissionLabels = {
  manageUsers: 'Manage Users', manageBackups: 'Manage Backups', manageSchedules: 'Manage Schedules',
  restore: 'Restore Backups', delete: 'Delete Backups', configure: 'Configure Settings',
  viewLogs: 'View Logs', manageRoles: 'Manage Roles',
};

export default function Roles() {
  const [roles, setRoles] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', permissions: { ...defaultPermissions } });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { can } = useAuth();

  const load = useCallback(() => {
    fetch(`${API}/api/roles`).then(r => r.json()).then(setRoles).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ name: '', description: '', permissions: { ...defaultPermissions } }); setDialogOpen(true); };
  const openEdit = (r) => { setEditing(r); setForm({ name: r.name, description: r.description || '', permissions: { ...r.permissions } }); setDialogOpen(true); };

  const togglePerm = (key) => {
    setForm({ ...form, permissions: { ...form.permissions, [key]: !form.permissions[key] } });
  };

  const save = async () => {
    if (!form.name) { setSnack({ open: true, msg: 'Name required', severity: 'warning' }); return; }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/roles/${editing.id}` : `${API}/api/roles`;
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) { const err = await r.json(); throw new Error(err.error); }
      setSnack({ open: true, msg: editing ? 'Role updated' : 'Role created', severity: 'success' });
      setDialogOpen(false); load();
    } catch (e) { setSnack({ open: true, msg: e.message || 'Failed', severity: 'error' }); }
  };

  const remove = async (id, name) => {
    if (['admin', 'operator', 'viewer'].includes(id)) {
      setSnack({ open: true, msg: 'Cannot delete built-in role', severity: 'warning' }); return;
    }
    try {
      await fetch(`${API}/api/roles/${id}`, { method: 'DELETE' });
      load(); setSnack({ open: true, msg: `Role "${name}" deleted`, severity: 'success' });
    } catch { setSnack({ open: true, msg: 'Failed to delete', severity: 'error' }); }
  };

  const builtIn = (id) => ['admin', 'operator', 'viewer'].includes(id);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">Roles</Typography>
        {can('manageRoles') && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Role</Button>}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Define user roles and their permissions
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
                  <TableCell sx={{ fontWeight: 600 }}>Role</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Permissions (enabled)</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Level</TableCell>
                  {can('manageRoles') && <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {roles.length === 0 ? (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                    <SecurityIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1 }} />
                    <Typography color="text.secondary">No roles</Typography>
                  </TableCell></TableRow>
                ) : roles.map((r) => {
                  const enabled = Object.entries(r.permissions || {}).filter(([, v]) => v).length;
                  const total = Object.keys(r.permissions || {}).length;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>{r.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{r.id}</Typography>
                      </TableCell>
                      <TableCell>{r.description || '—'}</TableCell>
                      <TableCell>
                        <Chip label={`${enabled}/${total}`} size="small" color={enabled === 0 ? 'default' : 'primary'} variant="outlined" />
                      </TableCell>
                      <TableCell>{r.level ?? 1}</TableCell>
                      {can('manageRoles') && (
                        <TableCell align="right">
                          <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(r)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          {!builtIn(r.id) && (
                            <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(r.id, r.name)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Role' : 'New Role'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5, py: 0.5 }}>
            <TextField label="Role Name" fullWidth required value={form.name}
              onChange={(e) => setForm({...form, name: e.target.value})} disabled={editing && builtIn(editing.id)} />
            <TextField label="Description" fullWidth multiline rows={2} value={form.description}
              onChange={(e) => setForm({...form, description: e.target.value})} />
            <Typography variant="subtitle2" sx={{ mt: 1 }}>Permissions</Typography>
            {Object.keys(form.permissions).map(key => (
              <FormControlLabel key={key}
                control={<Switch checked={form.permissions[key]} onChange={() => togglePerm(key)} />}
                label={permissionLabels[key] || key} />
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={!form.name}>{editing ? 'Update' : 'Create'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
