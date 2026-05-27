import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
  Tabs, Tab,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  Refresh as RefreshIcon, Link as LinkIcon, Cloud as CloudIcon,
  CloudUpload as CloudUploadIcon,
} from '@mui/icons-material';

const API = process.env.REACT_APP_API_URL || '';
const PROVIDERS = [
  { value: 'aws', label: 'Amazon S3', color: '#FF9900' },
  { value: 'azure', label: 'Azure Blob', color: '#0078D4' },
  { value: 'gcp', label: 'Google Cloud', color: '#4285F4' },
];

export default function CloudBackups() {
  const [tab, setTab] = useState(0);
  const [creds, setCreds] = useState([]);
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [credDialog, setCredDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingCred, setEditingCred] = useState(null);
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });

  const [credForm, setCredForm] = useState({
    name: '', provider: 'aws',
    credentials: { accessKeyId: '', secretAccessKey: '', region: 'us-east-1', bucket: '' },
  });

  const [backupForm, setBackupForm] = useState({
    name: '', destination: '', type: 'full', backupType: 'cloud',
    config: { cloudCredentialId: '', remotePath: '', bucket: '', compression: 'none', encryptionKey: '' },
  });

  const load = useCallback(() => {
    fetch(`${API}/api/cloud-credentials`).then(r => r.json()).then(setCreds).catch(() => {});
    fetch(`${API}/api/backups?type=cloud`).then(r => r.json()).then(b => {
      setBackups(b.filter(x => x.backupType === 'cloud').map(x => ({ ...x, type: 'cloud' })));
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  // Credential form helpers
  const resetCredForm = (provider = 'aws') => {
    const fields = {
      aws: { accessKeyId: '', secretAccessKey: '', region: 'us-east-1', bucket: '' },
      azure: { storageAccount: '', accessKey: '', container: '', endpoint: '' },
      gcp: { projectId: '', bucket: '', credentials: '' },
    };
    setCredForm({ name: '', provider, credentials: fields[provider] || fields.aws });
  };

  const openCredCreate = (provider) => { setEditingCred(null); resetCredForm(provider); setCredDialog(true); };
  const openCredEdit = (c) => {
    setEditingCred(c);
    setCredForm({ name: c.name, provider: c.provider, credentials: { ...c.credentials } });
    setCredDialog(true);
  };

  const saveCred = async () => {
    if (!credForm.name || !credForm.provider) {
      setSnack({ open: true, msg: 'Name and provider required', severity: 'warning' }); return;
    }
    const method = editingCred ? 'PUT' : 'POST';
    const url = editingCred ? `${API}/api/cloud-credentials/${editingCred.id}` : `${API}/api/cloud-credentials`;
    try {
      const body = { name: credForm.name, provider: credForm.provider, credentials: credForm.credentials };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      setSnack({ open: true, msg: editingCred ? 'Credentials updated' : 'Credentials created', severity: 'success' });
      setCredDialog(false); load();
    } catch { setSnack({ open: true, msg: 'Failed to save', severity: 'error' }); }
  };

  const deleteCred = async (id) => {
    try { await fetch(`${API}/api/cloud-credentials/${id}`, { method: 'DELETE' }); load(); }
    catch { setSnack({ open: true, msg: 'Failed to delete', severity: 'error' }); }
  };

  const testCred = async (id) => {
    try {
      const r = await fetch(`${API}/api/cloud-credentials/${id}/test`, { method: 'POST' });
      const data = await r.json();
      setSnack({ open: true, msg: data.success ? data.message : `Failed: ${data.error}`, severity: data.success ? 'success' : 'error' });
    } catch { setSnack({ open: true, msg: 'Test failed', severity: 'error' }); }
  };

  // Backup
  const openCreate = () => {
    setEditing(null);
    setBackupForm({
      name: '', destination: '', type: 'full', backupType: 'cloud',
      config: { cloudCredentialId: '', remotePath: '', bucket: '', compression: 'none', encryptionKey: '' },
    });
    setDialogOpen(true);
  };

  const saveBackup = async () => {
    if (!backupForm.name || !backupForm.config.cloudCredentialId) {
      setSnack({ open: true, msg: 'Name and cloud credentials required', severity: 'warning' }); return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;
    try {
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupForm),
      });
      if (!r.ok) throw new Error();
      setSnack({ open: true, msg: editing ? 'Updated' : 'Created', severity: 'success' });
      setDialogOpen(false); load();
    } catch { setSnack({ open: true, msg: 'Failed to save', severity: 'error' }); }
  };

  const deleteBackup = async (id) => {
    try { await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' }); load(); }
    catch { setSnack({ open: true, msg: 'Failed to delete', severity: 'error' }); }
  };

  const getProviderLabel = (p) => PROVIDERS.find(x => x.value === p)?.label || p;

  const renderCredFields = () => {
    const { provider, credentials } = credForm;
    const update = (k, v) => setCredForm({ ...credForm, credentials: { ...credentials, [k]: v } });

    switch (provider) {
      case 'aws':
        return (<>
          <TextField label="Access Key ID" fullWidth value={credentials.accessKeyId || ''} onChange={(e) => update('accessKeyId', e.target.value)} />
          <TextField label="Secret Access Key" type="password" fullWidth value={credentials.secretAccessKey || ''} onChange={(e) => update('secretAccessKey', e.target.value)} placeholder={editingCred ? 'Leave blank to keep' : ''} />
          <TextField label="Region" fullWidth value={credentials.region || 'us-east-1'} onChange={(e) => update('region', e.target.value)} />
          <TextField label="S3 Bucket" fullWidth value={credentials.bucket || ''} onChange={(e) => update('bucket', e.target.value)} />
          <TextField label="Endpoint (optional)" fullWidth value={credentials.endpoint || ''} onChange={(e) => update('endpoint', e.target.value)} placeholder="https://s3.custom.com" />
        </>);
      case 'azure':
        return (<>
          <TextField label="Storage Account" fullWidth value={credentials.storageAccount || ''} onChange={(e) => update('storageAccount', e.target.value)} />
          <TextField label="Access Key" type="password" fullWidth value={credentials.accessKey || ''} onChange={(e) => update('accessKey', e.target.value)} placeholder={editingCred ? 'Leave blank to keep' : ''} />
          <TextField label="Container" fullWidth value={credentials.container || ''} onChange={(e) => update('container', e.target.value)} />
          <TextField label="Endpoint (optional)" fullWidth value={credentials.endpoint || ''} onChange={(e) => update('endpoint', e.target.value)} />
        </>);
      case 'gcp':
        return (<>
          <TextField label="Project ID" fullWidth value={credentials.projectId || ''} onChange={(e) => update('projectId', e.target.value)} />
          <TextField label="GCS Bucket" fullWidth value={credentials.bucket || ''} onChange={(e) => update('bucket', e.target.value)} />
          <TextField label="Service Account JSON" multiline rows={4} fullWidth value={credentials.credentials || ''} onChange={(e) => update('credentials', e.target.value)} placeholder='Paste your service account key JSON' />
        </>);
      default: return null;
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">Cloud Backups</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<CloudIcon />} onClick={() => openCredCreate('aws')}>Add Cloud</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Cloud Backup</Button>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Amazon S3 &bull; Azure Blob &bull; Google Cloud Storage
      </Typography>

      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label={`Backups (${backups.length})`} />
        <Tab label={`Cloud Credentials (${creds.length})`} />
      </Tabs>

      {tab === 0 && (
        <Card>
          <CardContent sx={{ pb: '8px !important' }}>
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            </Box>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Cloud</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Remote Path</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {backups.length === 0 ? (
                    <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1 }} />
                      <Typography color="text.secondary">No cloud backups configured</Typography>
                    </TableCell></TableRow>
                  ) : backups.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{b.name}</Typography></TableCell>
                      <TableCell>{getProviderLabel(creds.find(c => c.id === b.config?.cloudCredentialId)?.provider)}</TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{b.config?.remotePath || '—'}</Typography></TableCell>
                      <TableCell><Chip label={b.status} size="small" color={b.status === 'completed' ? 'success' : b.status === 'failed' ? 'error' : b.status === 'running' ? 'info' : 'default'} /></TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{(b.createdAt || '').slice(0, 10)}</Typography></TableCell>
                      <TableCell align="right">
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => deleteBackup(b.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
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
            {creds.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <CloudIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1 }} />
                <Typography color="text.secondary">No cloud credentials configured</Typography>
                <Box sx={{ mt: 2, display: 'flex', gap: 1, justifyContent: 'center' }}>
                  {PROVIDERS.map(p => (
                    <Button key={p.value} variant="outlined" startIcon={<CloudIcon />} onClick={() => openCredCreate(p.value)}>
                      {p.label}
                    </Button>
                  ))}
                </Box>
              </Box>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Provider</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Bucket / Container</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Region</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {creds.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell><Typography sx={{ fontWeight: 600 }}>{c.name}</Typography></TableCell>
                        <TableCell><Chip label={getProviderLabel(c.provider)} size="small" variant="outlined" /></TableCell>
                        <TableCell>{c.credentials?.bucket || c.credentials?.container || '—'}</TableCell>
                        <TableCell>{c.credentials?.region || '—'}</TableCell>
                        <TableCell align="right">
                          <Tooltip title="Test"><IconButton size="small" onClick={() => testCred(c.id)}><LinkIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Edit"><IconButton size="small" onClick={() => openCredEdit(c)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Delete"><IconButton size="small" onClick={() => deleteCred(c.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
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

      {/* Cloud Credentials Dialog */}
      <Dialog open={credDialog} onClose={() => setCredDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingCred ? 'Edit Cloud Credentials' : 'Add Cloud Credentials'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField label="Credential Name" fullWidth value={credForm.name} onChange={(e) => setCredForm({...credForm, name: e.target.value})} />
            <TextField select label="Provider" fullWidth value={credForm.provider} onChange={(e) => resetCredForm(e.target.value)}>
              {PROVIDERS.map(p => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
            </TextField>
            {renderCredFields()}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCredDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveCred}>{editingCred ? 'Update' : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      {/* Backup Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle>New Cloud Backup</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5, py: 0.5 }}>
            <TextField label="Backup Name" fullWidth required value={backupForm.name} onChange={(e) => setBackupForm({...backupForm, name: e.target.value})} placeholder="e.g. S3 Weekly Backup" />
            <TextField select label="Cloud Credentials" fullWidth required value={backupForm.config?.cloudCredentialId || ''} onChange={(e) => setBackupForm({...backupForm, config: {...backupForm.config, cloudCredentialId: e.target.value}})}>
              {creds.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({getProviderLabel(c.provider)})</MenuItem>)}
              {creds.length === 0 && <MenuItem disabled value="">No credentials — add one first</MenuItem>}
            </TextField>
            <TextField label="Bucket / Container" fullWidth value={backupForm.config?.bucket || ''} onChange={(e) => setBackupForm({...backupForm, config: {...backupForm.config, bucket: e.target.value}})} placeholder="my-bucket" helperText="Override bucket/container from credentials" />
            <TextField label="Remote Path" fullWidth required value={backupForm.config?.remotePath || ''} onChange={(e) => setBackupForm({...backupForm, config: {...backupForm.config, remotePath: e.target.value}})} placeholder="backups/my-server/" />
            <TextField label="Local Source Path" fullWidth required value={backupForm.destination || ''} onChange={(e) => setBackupForm({...backupForm, destination: e.target.value})} placeholder="/data/to/backup" helperText="File or directory on this server to upload" />
            <TextField select label="Compression" fullWidth value={backupForm.config?.compression || 'none'} onChange={(e) => setBackupForm({...backupForm, config: {...backupForm.config, compression: e.target.value}})}>
              <MenuItem value="none">None</MenuItem>
              <MenuItem value="gzip">GZip (.gz)</MenuItem>
              <MenuItem value="zip">ZIP (.zip)</MenuItem>
            </TextField>
            <TextField label="Encryption Key (optional)" fullWidth value={backupForm.config?.encryptionKey || ''} onChange={(e) => setBackupForm({...backupForm, config: {...backupForm.config, encryptionKey: e.target.value}})} placeholder="AES-256 encryption passphrase" type="password" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveBackup}>Create</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
