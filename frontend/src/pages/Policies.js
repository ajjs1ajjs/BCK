import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
  Switch,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

const DEFAULT_POLICIES = [
  { id: '1', name: 'Daily Backup', description: 'Daily full backup with 7-day retention', type: 'full', retentionDays: 7, retentionCopies: 7, schedule: '0 2 * * *', enabled: true, targets: ['mysql', 'postgres'] },
  { id: '2', name: 'Weekly Archive', description: 'Weekly archive with 30-day retention', type: 'full', retentionDays: 30, retentionCopies: 4, schedule: '0 3 * * 0', enabled: true, targets: ['mysql', 'postgres', 'vmware'] },
  { id: '3', name: 'Monthly Compliance', description: 'Monthly backup for compliance (90 days)', type: 'full', retentionDays: 90, retentionCopies: 12, schedule: '0 4 1 * *', enabled: false, targets: ['all'] },
  { id: '4', name: 'Incremental Every 6h', description: 'Incremental backup every 6 hours', type: 'incremental', retentionDays: 3, retentionCopies: 12, schedule: '0 */6 * * *', enabled: false, targets: ['mysql'] },
];

export default function Policies() {
  const [policies, setPolicies] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bck-policies')) || DEFAULT_POLICIES; }
    catch { return DEFAULT_POLICIES; }
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', type: 'full', retentionDays: 30, retentionCopies: 10, schedule: '0 2 * * *', targets: [] });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { can } = useAuth();

  const persist = (items) => {
    localStorage.setItem('bck-policies', JSON.stringify(items));
    setPolicies(items);
  };

  const openCreate = () => { setEditing(null); setForm({ name: '', description: '', type: 'full', retentionDays: 30, retentionCopies: 10, schedule: '0 2 * * *', targets: [] }); setDialogOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ name: p.name, description: p.description, type: p.type, retentionDays: p.retentionDays, retentionCopies: p.retentionCopies, schedule: p.schedule, targets: p.targets }); setDialogOpen(true); };

  const save = () => {
    if (!form.name) { setSnack({ open: true, msg: 'Name required', severity: 'warning' }); return; }
    const item = { ...form, id: editing?.id || Date.now().toString(), enabled: editing?.enabled ?? true };
    if (editing) {
      persist(policies.map(p => p.id === editing.id ? item : p));
    } else {
      persist([...policies, item]);
    }
    setDialogOpen(false);
    setSnack({ open: true, msg: editing ? 'Policy updated' : 'Policy created', severity: 'success' });
  };

  const remove = (id) => {
    persist(policies.filter(p => p.id !== id));
    setSnack({ open: true, msg: 'Policy deleted', severity: 'success' });
  };

  const toggle = (id) => {
    persist(policies.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  const applyToBackups = (policy) => {
    setSnack({ open: true, msg: `Policy "${policy.name}" applied to matching backup jobs`, severity: 'info' });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">Backup Policies</Typography>
        {can('manageBackups') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Policy</Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Pre-configured backup policies with retention rules and schedules
      </Typography>

      <Card>
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />}>Refresh</Button>
          </Box>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Policy</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Retention</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Schedule</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Targets</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Enabled</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{p.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{p.description}</Typography>
                    </TableCell>
                    <TableCell><Chip label={p.type} size="small" color={p.type === 'full' ? 'primary' : 'secondary'} variant="outlined" /></TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{p.retentionDays}d / {p.retentionCopies} copies</Typography>
                    </TableCell>
                    <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{p.schedule}</Typography></TableCell>
                    <TableCell>
                      {p.targets?.map(t => <Chip key={t} label={t} size="small" variant="outlined" sx={{ mr: 0.3, mb: 0.3 }} />)}
                    </TableCell>
                    <TableCell>
                      <Switch size="small" checked={p.enabled} onChange={() => toggle(p.id)}
                        disabled={!can('manageBackups')} />
                    </TableCell>
                    <TableCell align="right">
                      {can('manageBackups') && (
                        <>
                          <Tooltip title="Apply"><IconButton size="small" onClick={() => applyToBackups(p)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(p)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(p.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Policy' : 'New Backup Policy'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField label="Policy Name" fullWidth value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <TextField label="Description" fullWidth multiline rows={2} value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} />
            <TextField select label="Backup Type" fullWidth value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
              <MenuItem value="full">Full</MenuItem>
              <MenuItem value="incremental">Incremental</MenuItem>
              <MenuItem value="differential">Differential</MenuItem>
            </TextField>
            <TextField label="Retention (days)" type="number" fullWidth value={form.retentionDays} onChange={(e) => setForm({...form, retentionDays: parseInt(e.target.value)})} />
            <TextField label="Min copies to keep" type="number" fullWidth value={form.retentionCopies} onChange={(e) => setForm({...form, retentionCopies: parseInt(e.target.value)})} />
            <TextField label="Cron Schedule" fullWidth value={form.schedule} onChange={(e) => setForm({...form, schedule: e.target.value})} placeholder="0 2 * * *" />
            <TextField select label="Target types" fullWidth SelectProps={{ multiple: true }} value={form.targets} onChange={(e) => setForm({...form, targets: e.target.value})}>
              <MenuItem value="all">All types</MenuItem>
              <MenuItem value="mysql">MySQL</MenuItem>
              <MenuItem value="postgres">PostgreSQL</MenuItem>
              <MenuItem value="oracle">Oracle</MenuItem>
              <MenuItem value="vmware">VMware</MenuItem>
              <MenuItem value="hyperv">Hyper-V</MenuItem>
              <MenuItem value="cloud">Cloud Storage</MenuItem>
            </TextField>
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
