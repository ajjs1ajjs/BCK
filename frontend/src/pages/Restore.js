import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Stepper, Step, StepLabel, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Chip, MenuItem, Snackbar, Alert,
  Radio, RadioGroup, FormControlLabel, FormControl, FormLabel, LinearProgress,
} from '@mui/material';
import {
  Restore as RestoreIcon, Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';

import { API } from '../utils/config';

export default function Restore() {
  const [backups, setBackups] = useState([]);
  const [connections, setConnections] = useState([]);
  const [sshConns, setSshConns] = useState([]);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const [restoreType, setRestoreType] = useState('original');
  const [target, setTarget] = useState({ connectionId: '', database: '', vmName: '', host: '', user: '', password: '', targetPath: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const [restoring, setRestoring] = useState(false);
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/backups`).then(r => r.json()).then(b => {
      setBackups(b.filter(x => x.status === 'completed' && x.resultFile));
    }).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/db-connections`).then(r => r.json()).then(setConnections).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/ssh-connections`).then(r => r.json()).then(setSshConns).catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const startRestore = async () => {
    if (!selected) { setSnack({ open: true, msg: t('restorePoint'), severity: 'warning' }); return; }
    setRestoring(true);
    const backupType = selected.backupType || selected.type;
    const config = restoreType === 'new'
      ? (['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'].includes(backupType) || backupType === 'ssh-db'
        ? { connectionId: target.connectionId, database: target.database, type: target.dbType }
        : backupType === 'ssh'
          ? { connectionId: target.connectionId, targetPath: target.targetPath }
          : backupType === 'host'
            ? { targetPath: target.targetPath }
            : backupType === 'cloud'
              ? { localPath: target.targetPath }
              : { vmName: target.vmName, host: target.host, user: target.user, password: target.password })
      : {};

    try {
      const r = await fetch(`${API}/api/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId: selected.id, targetType: restoreType, config }),
      });
      await r.json();
      setSnack({ open: true, msg: t('restoreSuccess'), severity: 'success' });
      setStep(0);
      setSelected(null);
    } catch {
      setSnack({ open: true, msg: t('restoreFailed'), severity: 'error' });
    }
    setRestoring(false);
  };

  const backupType = selected?.backupType || selected?.type;
  const isDB = ['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'].includes(backupType);
  const isVM = ['vmware', 'hyperv'].includes(backupType);
  const isHost = backupType === 'host' || backupType === 'ssh';
  const isSsh = backupType === 'ssh' || backupType === 'ssh-db';

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>{t('restore')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('restoreSubtitle')}
      </Typography>

      <Stepper activeStep={step} sx={{ mb: 3 }}>
        <Step><StepLabel>{t('restorePoint')}</StepLabel></Step>
        <Step><StepLabel>Configure</StepLabel></Step>
        <Step><StepLabel>{t('confirm')}</StepLabel></Step>
      </Stepper>

      {step === 0 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>{t('refresh')}</Button>
            </Box>
            {backups.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <RestoreIcon sx={{ fontSize: 48, color: 'text.secondary', opacity: 0.3, mb: 1 }} />
                <Typography color="text.secondary">{t('noBackupsConfigured')}</Typography>
              </Box>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600, width: 40 }}></TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('name')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('type')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{t('sourcePath')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {backups.map((b) => (
                      <TableRow
                        key={b.id}
                        hover
                        selected={selected?.id === b.id}
                        onClick={() => setSelected(b)}
                        sx={{ cursor: 'pointer', '&.Mui-selected': { bgcolor: 'rgba(124,58,237,0.08)' } }}
                      >
                        <TableCell>
                          <Radio checked={selected?.id === b.id} onChange={() => setSelected(b)} />
                        </TableCell>
                        <TableCell><Typography sx={{ fontWeight: 600 }}>{b.name}</Typography></TableCell>
                        <TableCell><Chip label={b.backupType || b.type} size="small" variant="outlined" /></TableCell>
                        <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{(b.completedAt || '').slice(0, 19).replace('T', ' ')}</Typography></TableCell>
                        <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{b.source}</Typography></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
              <Button variant="contained" disabled={!selected} onClick={() => setStep(1)}>Next</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Restore: {selected?.name}</Typography>
            <FormControl sx={{ mb: 3 }}>
              <FormLabel>Restore destination</FormLabel>
              <RadioGroup value={restoreType} onChange={(e) => setRestoreType(e.target.value)}>
                <FormControlLabel value="original" control={<Radio />} label="Restore to original location" />
                <FormControlLabel value="new" control={<Radio />} label="Restore to new location" />
              </RadioGroup>
            </FormControl>

            {restoreType === 'new' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {isDB && (<>
                  <TextField select label={t('targetConnection')} fullWidth value={target.connectionId}
                    onChange={(e) => setTarget({...target, connectionId: e.target.value})}>
                    {connections.filter(c => c.type === backupType).map(c => (
                      <MenuItem key={c.id} value={c.id}>{c.name} ({c.host})</MenuItem>
                    ))}
                  </TextField>
                  <TextField label="Target Database" fullWidth value={target.database}
                    onChange={(e) => setTarget({...target, database: e.target.value})} placeholder="new_database_name" />
                </>)}
                {backupType === 'ssh-db' && (<>
                  <TextField select label={t('targetConnection') || 'Target SSH'} fullWidth value={target.connectionId}
                    onChange={(e) => setTarget({...target, connectionId: e.target.value})}>
                    {sshConns.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.host})</MenuItem>)}
                  </TextField>
                  <TextField select label="DB Type" fullWidth value={target.dbType || 'mysql'}
                    onChange={(e) => setTarget({...target, dbType: e.target.value})}>
                    <MenuItem value="mysql">MySQL</MenuItem>
                    <MenuItem value="postgres">PostgreSQL</MenuItem>
                  </TextField>
                  <TextField label="Target Database" fullWidth value={target.database}
                    onChange={(e) => setTarget({...target, database: e.target.value})} placeholder="db_name" />
                </>)}
                {isVM && (<>
                  <TextField label="New VM Name" fullWidth value={target.vmName}
                    onChange={(e) => setTarget({...target, vmName: e.target.value})} placeholder="my-vm-restored" />
                  <TextField label={t('host')} fullWidth value={target.host}
                    onChange={(e) => setTarget({...target, host: e.target.value})} />
                  <TextField label={t('username')} fullWidth value={target.user}
                    onChange={(e) => setTarget({...target, user: e.target.value})} />
                  <TextField label={t('password')} type="password" fullWidth value={target.password}
                    onChange={(e) => setTarget({...target, password: e.target.value})} />
                </>)}
                {isHost && (
                  <>
                    {isSsh && (
                      <TextField select label={t('targetConnection') || 'Target SSH'} fullWidth value={target.connectionId}
                        onChange={(e) => setTarget({...target, connectionId: e.target.value})}>
                        {sshConns.map(c => <MenuItem key={c.id} value={c.id}>{c.name} ({c.host})</MenuItem>)}
                      </TextField>
                    )}
                    <TextField
                      label={t('targetPath') || 'Target path'}
                      fullWidth
                      value={target.targetPath}
                      onChange={(e) => setTarget({...target, targetPath: e.target.value})}
                      placeholder="/restore/host"
                      helperText={isSsh ? "Archive will be extracted on the remote server via SSH." : "Host archive will be extracted to this directory."}
                    />
                  </>
                )}
              </Box>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
              <Button onClick={() => setStep(0)}>Back</Button>
              <Button variant="contained" onClick={() => setStep(2)}>Next</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Confirm Restore</Typography>
            {restoring && <LinearProgress sx={{ mb: 2 }} />}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
              <Typography><strong>Backup:</strong> {selected?.name}</Typography>
              <Typography><strong>Type:</strong> {selected?.backupType || selected?.type}</Typography>
              <Typography><strong>Restore to:</strong> {restoreType === 'original' ? 'Original location' : 'New location'}</Typography>
              {selected?.resultFile && <Typography><strong>File:</strong> <code>{selected.resultFile}</code></Typography>}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => setStep(1)} disabled={restoring}>Back</Button>
              <Button variant="contained" color="primary" onClick={startRestore} disabled={restoring}>
                {restoring ? 'Restoring...' : t('restoreBtn')}
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
