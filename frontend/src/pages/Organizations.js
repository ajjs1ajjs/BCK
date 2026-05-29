import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, Button, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip,
  Skeleton, Alert,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  Business as OrgIcon, People as PeopleIcon,
} from '@mui/icons-material';
import { API } from '../utils/config';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export default function Organizations() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrg, setEditOrg] = useState(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const token = localStorage.getItem('token') || '';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/organizations`, { headers });
      setOrgs(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const openCreate = () => { setFormName(''); setFormSlug(''); setError(''); setEditOrg(null); setCreateOpen(true); };
  const openEdit = (org) => { setFormName(org.name); setFormSlug(org.slug); setError(''); setEditOrg(org); setCreateOpen(true); };

  const handleSave = async () => {
    setError('');
    if (!formName.trim()) return setError('Name is required');
    if (!editOrg && !formSlug.trim()) return setError('Slug is required');
    setSaving(true);
    try {
      const url = editOrg ? `${API}/api/organizations/${editOrg.id}` : `${API}/api/organizations`;
      const method = editOrg ? 'PUT' : 'POST';
      const body = editOrg ? { name: formName } : { name: formName, slug: formSlug };
      const r = await fetch(url, { method, headers, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) return setError(data.error || 'Failed');
      setCreateOpen(false);
      loadOrgs();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (org) => {
    if (org.id === 'default') return;
    if (!window.confirm(`Delete "${org.name}"? Users will be moved to Default Organization.`)) return;
    await fetch(`${API}/api/organizations/${org.id}`, { method: 'DELETE', headers });
    loadOrgs();
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Organizations</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage multi-tenant organizations and user grouping
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Organization</Button>
      </Stack>

      <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Slug</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Users</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading
                ? Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><Skeleton /></TableCell>)}
                  </TableRow>
                ))
                : orgs.map(org => (
                  <TableRow key={org.id} hover>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <OrgIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="body2" fontWeight={600}>{org.name}</Typography>
                        {org.id === 'default' && <Chip label="default" size="small" color="primary" />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" fontFamily="monospace" sx={{ bgcolor: 'action.hover', px: 0.8, py: 0.3, borderRadius: 1 }}>
                        {org.slug}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <PeopleIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                        <Typography variant="body2">{org.userCount || 0}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{formatDate(org.createdAt)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(org)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {org.id !== 'default' && (
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => handleDelete(org)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              }
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editOrg ? 'Edit Organization' : 'New Organization'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Organization Name" value={formName} onChange={e => setFormName(e.target.value)} fullWidth size="small" autoFocus />
            {!editOrg && (
              <TextField label="Slug (URL-safe, e.g. my-org)" value={formSlug}
                onChange={e => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                fullWidth size="small" helperText="Lowercase letters, numbers, hyphens only" />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editOrg ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
