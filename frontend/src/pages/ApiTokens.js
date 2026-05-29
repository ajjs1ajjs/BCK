import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip,
  Alert, Skeleton, FormGroup, FormControlLabel, Checkbox,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, ContentCopy as CopyIcon,
  Key as KeyIcon, Visibility as ShowIcon,
} from '@mui/icons-material';
import { API } from '../utils/config';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

const ALL_PERMISSIONS = [
  { key: 'manageBackups', label: 'Manage Backups' },
  { key: 'manageSchedules', label: 'Manage Schedules' },
  { key: 'restore', label: 'Restore' },
  { key: 'viewLogs', label: 'View Logs' },
  { key: 'configure', label: 'Configure Settings' },
  { key: 'manageUsers', label: 'Manage Users' },
];

export default function ApiTokens() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [newPerms, setNewPerms] = useState({});
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState(null); // { id, token }
  const [copied, setCopied] = useState(false);

  const token = localStorage.getItem('token') || '';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/tokens`, { headers });
      setTokens(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch(`${API}/api/tokens`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: newName, permissions: newPerms, expiresAt: newExpiry || null }),
      });
      const data = await r.json();
      if (r.ok) {
        setRevealed({ id: data.id, token: data.token });
        setCreateOpen(false);
        setNewName('');
        setNewExpiry('');
        setNewPerms({});
        loadTokens();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id, name) => {
    if (!window.confirm(`Revoke token "${name}"?`)) return;
    await fetch(`${API}/api/tokens/${id}`, { method: 'DELETE', headers });
    setTokens(prev => prev.filter(t => t.id !== id));
  };

  const copyToken = () => {
    navigator.clipboard.writeText(revealed?.token || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>API Tokens</Typography>
          <Typography variant="body2" color="text.secondary">
            Generate tokens for CI/CD pipelines and external integrations — no login required
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          New Token
        </Button>
      </Stack>

      {/* Revealed token dialog */}
      {revealed && (
        <Alert
          severity="success"
          icon={<ShowIcon />}
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" startIcon={<CopyIcon />} onClick={copyToken} color="inherit">
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button size="small" onClick={() => setRevealed(null)} color="inherit">Dismiss</Button>
            </Stack>
          }
          sx={{ mb: 3, fontFamily: 'monospace', wordBreak: 'break-all' }}
        >
          <strong>Token created — save it now, it won't be shown again:</strong>
          <br />
          <code style={{ fontSize: 12 }}>{revealed.token}</code>
        </Alert>
      )}

      <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Expires</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Last Used</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Permissions</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton /></TableCell>)}
                  </TableRow>
                ))
                : tokens.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                        <KeyIcon sx={{ fontSize: 40, opacity: 0.2, display: 'block', mx: 'auto', mb: 1 }} />
                        No API tokens yet — create one to start automating
                      </TableCell>
                    </TableRow>
                  )
                  : tokens.map(t => (
                    <TableRow key={t.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>{t.name}</Typography>
                      </TableCell>
                      <TableCell>{formatDate(t.createdAt)}</TableCell>
                      <TableCell>
                        {t.expiresAt
                          ? <Chip size="small" label={formatDate(t.expiresAt)} color={new Date(t.expiresAt) < new Date() ? 'error' : 'default'} />
                          : <Chip size="small" label="Never" variant="outlined" />}
                      </TableCell>
                      <TableCell>{formatDate(t.lastUsedAt)}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap">
                          {Object.entries(t.permissions || {}).filter(([, v]) => v).map(([k]) => (
                            <Chip key={k} label={k} size="small" variant="outlined" sx={{ fontSize: 10 }} />
                          ))}
                          {Object.values(t.permissions || {}).every(v => !v) && (
                            <Typography variant="caption" color="text.secondary">All (role-based)</Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Revoke">
                          <IconButton size="small" color="error" onClick={() => handleRevoke(t.id, t.name)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))
              }
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Create Token Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create API Token</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Token Name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. github-ci, deploy-script" fullWidth size="small" autoFocus />
            <TextField label="Expires At (optional)" type="datetime-local" value={newExpiry} onChange={e => setNewExpiry(e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <Box>
              <Typography variant="subtitle2" gutterBottom>Permissions (leave all unchecked = inherit role permissions)</Typography>
              <FormGroup row>
                {ALL_PERMISSIONS.map(p => (
                  <FormControlLabel key={p.key} control={
                    <Checkbox size="small" checked={!!newPerms[p.key]} onChange={e => setNewPerms(prev => ({ ...prev, [p.key]: e.target.checked }))} />
                  } label={<Typography variant="body2">{p.label}</Typography>} />
                ))}
              </FormGroup>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : 'Create Token'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Usage example */}
      <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>Usage</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>Use the token in the Authorization header:</Typography>
          <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', fontSize: 12 }}>
            curl -H "Authorization: Bearer bck_your_token_here" http://localhost:9000/api/backups
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
