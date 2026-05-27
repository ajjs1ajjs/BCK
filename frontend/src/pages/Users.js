import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
  Switch,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  Refresh as RefreshIcon, Person as PersonIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || '';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer', email: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { can } = useAuth();

  const load = useCallback(() => {
    fetch(`${API}/api/users`).then(r => r.json()).then(setUsers).catch(() => {});
    fetch(`${API}/api/roles`).then(r => r.json()).then(setRoles).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ username: '', password: '', role: 'viewer', email: '' }); setDialogOpen(true); };
  const openEdit = (u) => { setEditing(u); setForm({ username: u.username, password: '', role: u.role, email: u.email || '' }); setDialogOpen(true); };

  const save = async () => {
    if (!form.username || (!editing && !form.password) || !form.role) {
      setSnack({ open: true, msg: 'Username, password, and role required', severity: 'warning' }); return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/users/${editing.id}` : `${API}/api/users`;
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) { const err = await r.json(); throw new Error(err.error); }
      setSnack({ open: true, msg: editing ? 'User updated' : 'User created', severity: 'success' });
      setDialogOpen(false); load();
    } catch (e) { setSnack({ open: true, msg: e.message || 'Failed', severity: 'error' }); }
  };

  const remove = async (id) => {
    try {
      await fetch(`${API}/api/users/${id}`, { method: 'DELETE' });
      load();
      setSnack({ open: true, msg: 'User deleted', severity: 'success' });
    } catch { setSnack({ open: true, msg: 'Failed to delete', severity: 'error' }); }
  };

  const toggleActive = async (u) => {
    try {
      await fetch(`${API}/api/users/${u.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !u.active }) });
      load();
    } catch (_) { /* ignore */ }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">Users</Typography>
        {can('manageUsers') && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New User</Button>}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage user accounts and role assignments
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
                  <TableCell sx={{ fontWeight: 600 }}>Username</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Role</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                  {can('manageUsers') && <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <PersonIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1 }} />
                    <Typography color="text.secondary">No users</Typography>
                  </TableCell></TableRow>
                ) : users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell><Typography sx={{ fontWeight: 600 }}>{u.username}</Typography></TableCell>
                    <TableCell>
                      <Chip label={u.role} size="small" color={u.role === 'admin' ? 'error' : u.role === 'operator' ? 'warning' : 'default'} variant="outlined" />
                    </TableCell>
                    <TableCell>{u.email || '—'}</TableCell>
                    <TableCell>
                      {can('manageUsers') ? (
                        <Switch size="small" checked={u.active !== false} onChange={() => toggleActive(u)} />
                      ) : (
                        <Chip label={u.active !== false ? 'Active' : 'Disabled'} size="small" color={u.active !== false ? 'success' : 'default'} />
                      )}
                    </TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{(u.createdAt || '').slice(0, 10)}</Typography></TableCell>
                    {can('manageUsers') && (
                      <TableCell align="right">
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(u)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        {u.id !== 'admin' && u.id !== 'operator' && u.id !== 'viewer' && (
                          <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(u.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit User' : 'New User'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5, py: 0.5 }}>
            <TextField label="Username" fullWidth required value={form.username} onChange={(e) => setForm({...form, username: e.target.value})}
              disabled={editing && (editing.id === 'admin' || editing.id === 'operator' || editing.id === 'viewer')} />
            <TextField label="Password" type="password" fullWidth required={!editing} value={form.password}
              onChange={(e) => setForm({...form, password: e.target.value})}
              placeholder={editing ? 'Leave blank to keep current' : ''} />
            <TextField select label="Role" fullWidth required value={form.role} onChange={(e) => setForm({...form, role: e.target.value})}>
              {roles.map(r => <MenuItem key={r.id} value={r.id}>{r.name} ({r.id})</MenuItem>)}
            </TextField>
            <TextField label="Email" fullWidth value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} placeholder="user@example.com" type="email" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>{editing ? 'Update' : 'Create'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
