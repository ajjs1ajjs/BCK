import { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Switch, List, ListItem, ListItemText,
  Chip, IconButton, Tooltip, Snackbar, Alert, MenuItem,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  Refresh as RefreshIcon, Schedule as ScheduleIcon,
} from '@mui/icons-material';

const API = process.env.REACT_APP_API_URL || '';

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
  { label: 'Monthly (1st)', value: '0 0 1 * *' },
  { label: 'Custom', value: '' },
];

export default function Schedules() {
  const [schedules, setSchedules] = useState([]);
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', cronExpression: '* * * * *', backupId: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });

  const load = useCallback(() => {
    fetch(`${API}/api/schedules`).then(r => r.json()).then(setSchedules).catch(() => {});
    fetch(`${API}/api/backups`).then(r => r.json()).then(setBackups).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ name: '', cronExpression: '0 0 * * *', backupId: '' }); setDialogOpen(true); };
  const openEdit = (s) => { setEditing(s); setForm({ name: s.name, cronExpression: s.cronExpression || s.cron, backupId: s.backupId || '' }); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.name || !form.cronExpression || !form.backupId) {
      setSnack({ open: true, msg: 'All fields required', severity: 'warning' });
      return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/schedules/${editing.id}` : `${API}/api/schedules`;
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error();
      setSnack({ open: true, msg: editing ? 'Schedule updated' : 'Schedule created', severity: 'success' });
      setDialogOpen(false);
      load();
    } catch {
      setSnack({ open: true, msg: 'Failed to save', severity: 'error' });
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`${API}/api/schedules/${id}`, { method: 'DELETE' });
      setSnack({ open: true, msg: 'Schedule deleted', severity: 'success' });
      load();
    } catch {
      setSnack({ open: true, msg: 'Failed to delete', severity: 'error' });
    }
  };

  const toggleEnabled = async (s) => {
    const updated = { ...s, enabled: !s.enabled };
    try {
      await fetch(`${API}/api/schedules/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      load();
    } catch { /* ignore */ }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">Schedules</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          New Schedule
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Automated backup schedules — {schedules.length} configured
      </Typography>

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
          </Box>

          {schedules.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography color="text.secondary">No schedules yet. Create one to automate backups.</Typography>
            </Box>
          ) : (
            <List disablePadding>
              {schedules.map((s) => (
                <ListItem
                  key={s.id}
                  sx={{
                    px: 2, py: 1.5, borderRadius: 1, mb: 0.5,
                    bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
                  }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography sx={{ fontWeight: 600 }}>{s.name}</Typography>
                        <Chip label={s.enabled !== false ? 'Active' : 'Disabled'} size="small" color={s.enabled !== false ? 'success' : 'default'} />
                      </Box>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                          Cron: {s.cronExpression || s.cron}
                        </Typography>
                        {s.backupId && (
                          <Chip label={`Backup: ${backups.find(b => b.id === s.backupId)?.name || s.backupId}`} size="small" variant="outlined" />
                        )}
                        <Typography variant="caption">
                          Created: {(s.createdAt || '').slice(0, 10)}
                        </Typography>
                      </Box>
                    }
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 2 }}>
                    <Switch
                      checked={s.enabled !== false}
                      onChange={() => toggleEnabled(s)}
                      size="small"
                    />
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(s)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" onClick={() => handleDelete(s.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle>{editing ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5, py: 0.5 }}>
            <TextField label="Schedule Name" fullWidth required value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="e.g. Nightly DB Backup" />

            <TextField
              select label="Frequency" fullWidth value={CRON_PRESETS.find(p => p.value === form.cronExpression) ? form.cronExpression : 'custom'}
              onChange={(e) => {
                if (e.target.value === 'custom') return;
                setForm({...form, cronExpression: e.target.value});
              }}
            >
              {CRON_PRESETS.map((p) => (
                <MenuItem key={p.label} value={p.value || 'custom'}>{p.label}</MenuItem>
              ))}
            </TextField>

            {!CRON_PRESETS.find(p => p.value === form.cronExpression) && (
              <TextField label="Cron Expression (custom)" fullWidth value={form.cronExpression} onChange={(e) => setForm({...form, cronExpression: e.target.value})} placeholder="0 */6 * * *" helperText="min hour day month weekday" />
            )}

            <TextField select label="Backup Job" fullWidth required value={form.backupId} onChange={(e) => setForm({...form, backupId: e.target.value})}>
              {backups.map((b) => (
                <MenuItem key={b.id} value={b.id}>{b.name} ({b.type || b.backupType})</MenuItem>
              ))}
              {backups.length === 0 && <MenuItem disabled value="">No backup jobs — create one first</MenuItem>}
            </TextField>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2">Enabled</Typography>
              <Switch checked={form.enabled !== false} onChange={(e) => setForm({...form, enabled: e.target.checked})} />
            </Box>

            <TextField select label="Notify on" fullWidth value={form.notifyOn || 'failure'} onChange={(e) => setForm({...form, notifyOn: e.target.value})}>
              <MenuItem value="never">Never</MenuItem>
              <MenuItem value="failure">Failure only</MenuItem>
              <MenuItem value="all">All results</MenuItem>
            </TextField>

            <TextField label="Description (optional)" fullWidth multiline rows={2} value={form.description || ''} onChange={(e) => setForm({...form, description: e.target.value})} placeholder="What this schedule does" />

            <Box sx={{ display: 'flex', gap: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <ScheduleIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.3 }} />
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Current schedule: <strong>{form.cronExpression || '—'}</strong>
                </Typography>
                {form.cronExpression && (
                  <Typography variant="caption" color="text.secondary">
                    {form.cronExpression === '0 * * * *' ? 'Runs every hour' :
                     form.cronExpression === '0 0 * * *' ? 'Runs daily at midnight' :
                     form.cronExpression === '0 0 * * 0' ? 'Runs weekly on Sunday' :
                     form.cronExpression === '0 0 1 * *' ? 'Runs monthly on 1st' :
                     'Custom schedule'}
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
