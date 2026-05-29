import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Switch, List, ListItem,
  ListItemText, Snackbar, Alert, Grid, MenuItem, Chip, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Checkbox, FormControlLabel,
  FormGroup, IconButton, Stack
} from '@mui/material';
import {
  DarkMode as DarkModeIcon, Save as SaveIcon, Refresh as RefreshIcon,
  CheckCircle as CheckIcon, Cancel as CancelIcon, Add as AddIcon,
  Delete as DeleteIcon, Edit as EditIcon, History as HistoryIcon,
  Send as SendIcon
} from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';

import { API } from '../utils/config';

export default function Settings({ toggleTheme, isDark }) {
  const [tab, setTab] = useState(0);
  const [settings, setSettings] = useState({
    smtp: { host: '', port: 587, user: '', password: '', from: '', encryption: 'tls' },
    retention: { enabled: true, days: 30, copies: 10, customLimitEnabled: false, customLimitGB: 50 },
    notifications: { email: false, emailOnSuccess: false, slack: '', discord: '', telegram: '', telegramBotToken: '', webhook: '' },
    schedule: { timezone: 'UTC' },
    security: { sessionTimeout: 60, preventConcurrent: false, minPasswordLength: 6 },
    advanced: { tempPath: '', bandwidthLimit: 0, compressionLevel: 'medium' },
    network: { appUrl: '', bindHost: '0.0.0.0', localIp: '', effectiveAppUrl: '' },
    ldap: { enabled: false, url: 'ldap://localhost:389', baseDn: '', bindDn: '', bindPassword: '', userFilter: '(sAMAccountName={{username}})', groupMapping: '{}' },
  });
  const [tools, setTools] = useState({});
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { t } = useTranslation();

  // Webhooks state
  const [webhooks, setWebhooks] = useState([]);
  const [whDialogOpen, setWhDialogOpen] = useState(false);
  const [editingWh, setEditingWh] = useState(null);
  const [whForm, setWhForm] = useState({ name: '', url: '', secret: '', events: [], retries: 3 });
  
  // Webhook deliveries state
  const [deliveries, setDeliveries] = useState([]);
  const [delDialogOpen, setDelDialogOpen] = useState(false);
  const [selectedWhName, setSelectedWhName] = useState('');

  const load = useCallback(() => {
    fetch(`${API}/api/settings`).then(r => r.json()).then(setSettings).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/tools`).then(r => r.json()).then(setTools).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/webhooks`).then(r => r.json()).then(setWebhooks).catch(e => console.error('Webhooks load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      const r = await fetch(`${API}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (r.ok) setSnack({ open: true, msg: t('settingsSaved'), severity: 'success' });
      else throw new Error();
    } catch { setSnack({ open: true, msg: t('failedToSave'), severity: 'error' }); }
  };

  const updateSMTP = (k, v) => setSettings({ ...settings, smtp: { ...settings.smtp, [k]: v } });
  const updateRetention = (k, v) => setSettings({ ...settings, retention: { ...settings.retention, [k]: v } });
  const updateNotifications = (k, v) => setSettings({ ...settings, notifications: { ...settings.notifications, [k]: v } });
  const updateSecurity = (k, v) => setSettings({ ...settings, security: { ...(settings.security || {}), [k]: v } });
  const updateAdvanced = (k, v) => setSettings({ ...settings, advanced: { ...(settings.advanced || {}), [k]: v } });
  const updateNetwork = (k, v) => setSettings({ ...settings, network: { ...(settings.network || {}), [k]: v } });
  const updateLDAP = (k, v) => setSettings({ ...settings, ldap: { ...(settings.ldap || {}), [k]: v } });

  const toolStatus = (name) => {
    const statusObj = tools[name];
    if (!statusObj) return { label: t('loading'), color: 'default' };
    return statusObj.available ? { label: t('installed'), color: 'success' } : { label: t('notFoundStatus'), color: 'error' };
  };

  // LDAP Connection Test
  const testLdap = async () => {
    try {
      const r = await fetch(`${API}/api/auth/ldap/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings.ldap),
      });
      const data = await r.json();
      if (data.success) {
        setSnack({ open: true, msg: `LDAP Connection Successful! Found ${data.userCount} users.`, severity: 'success' });
      } else {
        setSnack({ open: true, msg: `LDAP Test Failed: ${data.error}`, severity: 'error' });
      }
    } catch (e) {
      setSnack({ open: true, msg: `Request failed: ${e.message}`, severity: 'error' });
    }
  };

  // Webhook handlers
  const openAddWebhook = () => {
    setEditingWh(null);
    setWhForm({ name: '', url: '', secret: '', events: ['backup.completed', 'backup.failed'], retries: 3 });
    setWhDialogOpen(true);
  };

  const openEditWebhook = (wh) => {
    setEditingWh(wh);
    setWhForm({ name: wh.name, url: wh.url, secret: wh.secret || '', events: wh.events || [], retries: wh.retries || 3 });
    setWhDialogOpen(true);
  };

  const saveWebhook = async () => {
    try {
      const url = editingWh ? `${API}/api/webhooks/${editingWh.id}` : `${API}/api/webhooks`;
      const method = editingWh ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(whForm),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || 'Failed to save webhook');
      }
      setWhDialogOpen(false);
      setSnack({ open: true, msg: 'Webhook saved successfully', severity: 'success' });
      load();
    } catch (e) {
      setSnack({ open: true, msg: e.message, severity: 'error' });
    }
  };

  const deleteWebhook = async (id) => {
    if (!window.confirm('Are you sure you want to delete this webhook endpoint?')) return;
    try {
      const r = await fetch(`${API}/api/webhooks/${id}`, { method: 'DELETE' });
      if (r.ok) {
        setSnack({ open: true, msg: 'Webhook deleted', severity: 'success' });
        load();
      } else {
        throw new Error();
      }
    } catch {
      setSnack({ open: true, msg: 'Failed to delete webhook', severity: 'error' });
    }
  };

  const testWebhook = async (id) => {
    try {
      const r = await fetch(`${API}/api/webhooks/${id}/test`, { method: 'POST' });
      const data = await r.json();
      if (data.success) {
        setSnack({ open: true, msg: `Webhook test completed! Status: ${data.statusCode}`, severity: 'success' });
      } else {
        setSnack({ open: true, msg: `Webhook test failed: ${data.error || ('Status ' + data.statusCode)}`, severity: 'warning' });
      }
    } catch (e) {
      setSnack({ open: true, msg: `Test request failed: ${e.message}`, severity: 'error' });
    }
  };

  const viewDeliveries = async (wh) => {
    setSelectedWhName(wh.name);
    try {
      const r = await fetch(`${API}/api/webhooks/${wh.id}/deliveries`);
      if (r.ok) {
        const data = await r.json();
        setDeliveries(data);
        setDelDialogOpen(true);
      }
    } catch (e) {
      setSnack({ open: true, msg: 'Failed to load deliveries: ' + e.message, severity: 'error' });
    }
  };

  const handleEventToggle = (ev) => {
    const next = whForm.events.includes(ev)
      ? whForm.events.filter(e => e !== ev)
      : [...whForm.events, ev];
    setWhForm({ ...whForm, events: next });
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>{t('settingsTitle')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('settingsSubtitle')}
      </Typography>

      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label={t('settingsGeneral')} />
        <Tab label={t('settingsNotifications')} />
        <Tab label={t('settingsRetention')} />
        <Tab label={t('settingsSecurity')} />
        <Tab label={t('settingsAdvanced')} />
        <Tab label={t('settingsLdap')} />
        <Tab label="Webhooks" />
        <Tab label={t('settingsSystemTools')} />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>{t('settingsAppearance')}</Typography>
                <List disablePadding>
                  <ListItem sx={{ px: 0 }}>
                    <DarkModeIcon sx={{ mr: 2, color: 'text.secondary' }} />
                    <ListItemText primary={t('darkMode')} secondary={t('darkModeDesc')} />
                    <Switch checked={isDark} onChange={toggleTheme} />
                  </ListItem>
                </List>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>{t('scheduleDefaults')}</Typography>
                <TextField select label={t('timezone')} fullWidth value={settings.schedule.timezone}
                  onChange={(e) => setSettings({ ...settings, schedule: { ...settings.schedule, timezone: e.target.value } })}>
                  {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Kyiv', 'Asia/Tokyo', 'Asia/Shanghai'].map(tz => (
                    <MenuItem key={tz} value={tz}>{tz}</MenuItem>
                  ))}
                </TextField>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary">{t('version')}</Typography>
                  <Typography>BCK Backup Solution v1.0.0</Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>{t('networkAccess')}</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label={t('applicationUrl')}
                    fullWidth
                    value={(settings.network && settings.network.appUrl) || ''}
                    onChange={(e) => updateNetwork('appUrl', e.target.value)}
                    placeholder={(settings.network && settings.network.effectiveAppUrl) || 'http://192.168.1.10:6000'}
                    helperText={t('applicationUrlDesc')}
                  />
                  <TextField
                    label={t('bindHost')}
                    fullWidth
                    value={(settings.network && settings.network.bindHost) || '0.0.0.0'}
                    onChange={(e) => updateNetwork('bindHost', e.target.value)}
                    helperText={t('bindHostDesc')}
                  />
                  <Box>
                    <Typography variant="body2" color="text.secondary">{t('detectedLocalIp')}</Typography>
                    <Chip label={(settings.network && settings.network.localIp) || '127.0.0.1'} size="small" sx={{ mt: 0.75, fontFamily: 'monospace' }} />
                  </Box>
                  <Box>
                    <Typography variant="body2" color="text.secondary">{t('currentAccessUrl')}</Typography>
                    <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {(settings.network && settings.network.effectiveAppUrl) || ''}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {tab === 1 && (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>{t('smtp')}</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField label="SMTP Host" fullWidth value={settings.smtp.host} onChange={(e) => updateSMTP('host', e.target.value)} placeholder="smtp.gmail.com" />
                  <TextField label={t('port')} type="number" fullWidth value={settings.smtp.port} onChange={(e) => updateSMTP('port', parseInt(e.target.value))} />
                  <TextField select label={t('encryption')} fullWidth value={settings.smtp.encryption} onChange={(e) => updateSMTP('encryption', e.target.value)}>
                    <MenuItem value="tls">TLS</MenuItem>
                    <MenuItem value="ssl">SSL</MenuItem>
                    <MenuItem value="none">None</MenuItem>
                  </TextField>
                  <TextField label={t('username')} fullWidth value={settings.smtp.user} onChange={(e) => updateSMTP('user', e.target.value)} />
                  <TextField label={t('password')} type="password" fullWidth value={settings.smtp.password} onChange={(e) => updateSMTP('password', e.target.value)} />
                  <TextField label="From address" fullWidth value={settings.smtp.from} onChange={(e) => updateSMTP('from', e.target.value)} placeholder="backup@example.com" />
                </Box>
                <List disablePadding sx={{ mt: 2 }}>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText primary={t('emailOnFailure')} secondary={t('emailOnFailureDesc')} />
                    <Switch checked={settings.notifications.email} onChange={(e) => updateNotifications('email', e.target.checked)} />
                  </ListItem>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText primary={t('emailOnSuccess')} secondary={t('emailOnSuccessDesc')} />
                    <Switch checked={settings.notifications.emailOnSuccess} onChange={(e) => updateNotifications('emailOnSuccess', e.target.checked)} />
                  </ListItem>
                </List>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card sx={{ mb: 2.5 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Slack</Typography>
                <TextField label={t('slackWebhook')} fullWidth value={settings.notifications.slack}
                  onChange={(e) => updateNotifications('slack', e.target.value)}
                  placeholder="https://hooks.slack.com/services/..." />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {t('slackDesc')}
                </Typography>
              </CardContent>
            </Card>

            <Card sx={{ mb: 2.5 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Discord</Typography>
                <TextField label={t('discordWebhook')} fullWidth value={settings.notifications.discord}
                  onChange={(e) => updateNotifications('discord', e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..." />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {t('discordDesc')}
                </Typography>
              </CardContent>
            </Card>

            <Card sx={{ mb: 2.5 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Telegram</Typography>
                <TextField label={t('telegramBotToken')} fullWidth value={settings.notifications.telegramBotToken}
                  onChange={(e) => updateNotifications('telegramBotToken', e.target.value)}
                  placeholder="123456:ABC-def" />
                <TextField label={t('telegramChatId')} fullWidth value={settings.notifications.telegram}
                  onChange={(e) => updateNotifications('telegram', e.target.value)}
                  placeholder="-1001234567890" sx={{ mt: 2 }} />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {t('telegramDesc')}
                </Typography>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>{t('genericWebhook')}</Typography>
                <TextField label={t('webhookUrl')} fullWidth value={settings.notifications.webhook}
                  onChange={(e) => updateNotifications('webhook', e.target.value)}
                  placeholder="https://your-server.com/webhook" />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {t('genericWebhookDesc')}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {tab === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('retentionPolicies')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 400 }}>
              <List disablePadding>
                <ListItem sx={{ px: 0 }}>
                  <ListItemText primary={t('enableRetentionPolicy')} secondary={t('enableRetentionPolicyDesc')} />
                  <Switch checked={settings.retention.enabled} onChange={(e) => updateRetention('enabled', e.target.checked)} />
                </ListItem>
              </List>
              <TextField label={t('keepBackupsForDays')} type="number" fullWidth value={settings.retention.days}
                onChange={(e) => updateRetention('days', parseInt(e.target.value) || 0)} disabled={!settings.retention.enabled} />
              <TextField label={t('minCopiesToKeep')} type="number" fullWidth value={settings.retention.copies}
                onChange={(e) => updateRetention('copies', parseInt(e.target.value) || 0)} disabled={!settings.retention.enabled} />

              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2, mt: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('storage')}</Typography>
                <List disablePadding>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText primary={t('limitStorageUsage')} secondary={t('limitStorageUsageDesc')} />
                    <Switch checked={settings.retention.customLimitEnabled || false} onChange={(e) => updateRetention('customLimitEnabled', e.target.checked)} />
                  </ListItem>
                </List>
                <TextField label={t('customStorageLimit')} type="number" fullWidth sx={{ mt: 1.5 }}
                  value={settings.retention.customLimitGB || 50}
                  onChange={(e) => updateRetention('customLimitGB', parseInt(e.target.value) || 0)}
                  disabled={!settings.retention.customLimitEnabled} />
              </Box>
            </Box>
          </CardContent>
        </Card>
      )}

      {tab === 3 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('settingsSecurity')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 400 }}>
              <TextField
                label={t('sessionTimeout')} type="number" fullWidth
                value={(settings.security && settings.security.sessionTimeout) || 60}
                onChange={(e) => updateSecurity('sessionTimeout', parseInt(e.target.value) || 0)}
              />
              <TextField
                label={t('minPasswordLength')} type="number" fullWidth
                value={(settings.security && settings.security.minPasswordLength) || 6}
                onChange={(e) => updateSecurity('minPasswordLength', parseInt(e.target.value) || 0)}
              />
              <List disablePadding>
                <ListItem sx={{ px: 0 }}>
                  <ListItemText primary={t('preventConcurrent')} />
                  <Switch
                    checked={(settings.security && settings.security.preventConcurrent) || false}
                    onChange={(e) => updateSecurity('preventConcurrent', e.target.checked)}
                  />
                </ListItem>
              </List>
            </Box>
          </CardContent>
        </Card>
      )}

      {tab === 4 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('settingsAdvanced')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 500 }}>
              <TextField
                label={t('tempPath')} fullWidth
                value={(settings.advanced && settings.advanced.tempPath) || ''}
                onChange={(e) => updateAdvanced('tempPath', e.target.value)}
                placeholder="e.g. C:\temp or /tmp"
              />
              <TextField
                label={t('bandwidthLimit')} type="number" fullWidth
                value={(settings.advanced && settings.advanced.bandwidthLimit) || 0}
                onChange={(e) => updateAdvanced('bandwidthLimit', parseInt(e.target.value) || 0)}
              />
              <TextField
                select label={t('compressionLevel')} fullWidth
                value={(settings.advanced && settings.advanced.compressionLevel) || 'medium'}
                onChange={(e) => updateAdvanced('compressionLevel', e.target.value)}
              >
                <MenuItem value="none">{t('compressionNone')}</MenuItem>
                <MenuItem value="low">{t('compressionLow')}</MenuItem>
                <MenuItem value="medium">{t('compressionMedium')}</MenuItem>
                <MenuItem value="high">{t('compressionHigh')}</MenuItem>
              </TextField>
            </Box>
          </CardContent>
        </Card>
      )}

      {tab === 5 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('settingsLdap')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 500 }}>
              <List disablePadding>
                <ListItem sx={{ px: 0 }}>
                  <ListItemText primary={t('ldapEnabled')} />
                  <Switch
                    checked={(settings.ldap && settings.ldap.enabled) || false}
                    onChange={(e) => updateLDAP('enabled', e.target.checked)}
                  />
                </ListItem>
              </List>

              <TextField
                label={t('ldapServerUrl')} fullWidth
                value={(settings.ldap && settings.ldap.url) || ''}
                onChange={(e) => updateLDAP('url', e.target.value)}
                placeholder="ldap://localhost:389"
                disabled={!(settings.ldap && settings.ldap.enabled)}
              />

              <TextField
                label={t('ldapBaseDn')} fullWidth
                value={(settings.ldap && settings.ldap.baseDn) || ''}
                onChange={(e) => updateLDAP('baseDn', e.target.value)}
                placeholder="dc=example,dc=org"
                disabled={!(settings.ldap && settings.ldap.enabled)}
              />

              <TextField
                label={t('ldapBindDn')} fullWidth
                value={(settings.ldap && settings.ldap.bindDn) || ''}
                onChange={(e) => updateLDAP('bindDn', e.target.value)}
                placeholder="cn=admin,dc=example,dc=org"
                disabled={!(settings.ldap && settings.ldap.enabled)}
              />

              <TextField
                label={t('ldapBindPassword')} type="password" fullWidth
                value={(settings.ldap && settings.ldap.bindPassword) || ''}
                onChange={(e) => updateLDAP('bindPassword', e.target.value)}
                disabled={!(settings.ldap && settings.ldap.enabled)}
              />

              <TextField
                label={t('ldapUserFilter')} fullWidth
                value={(settings.ldap && settings.ldap.userFilter) || ''}
                onChange={(e) => updateLDAP('userFilter', e.target.value)}
                placeholder="(sAMAccountName={{username}})"
                disabled={!(settings.ldap && settings.ldap.enabled)}
              />

              <TextField
                label={t('ldapGroupMapping')} fullWidth multiline rows={3}
                value={(settings.ldap && settings.ldap.groupMapping) || ''}
                onChange={(e) => updateLDAP('groupMapping', e.target.value)}
                placeholder='{ "CN=Admins,CN=Users,DC=example,DC=org": "admin" }'
                disabled={!(settings.ldap && settings.ldap.enabled)}
                helperText="JSON mapping of LDAP/Active Directory Groups to BCK Roles (admin, operator, viewer)"
              />

              <Box sx={{ mt: 1 }}>
                <Button variant="outlined" onClick={testLdap} disabled={!(settings.ldap && settings.ldap.enabled)}>
                  {t('testConnection')}
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Card>
      )}

      {tab === 6 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Outgoing Webhook Endpoints</Typography>
              <Button variant="contained" startIcon={<AddIcon />} size="small" onClick={openAddWebhook}>
                Add Endpoint
              </Button>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Configure endpoints to receive HTTP POST payloads when backup events occur. Webhooks are signed with HMAC-SHA256.
            </Typography>

            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>URL</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Events</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Active</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {webhooks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        <Typography color="text.secondary" sx={{ py: 2 }}>No webhook endpoints configured.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    webhooks.map((wh) => (
                      <TableRow key={wh.id}>
                        <TableCell sx={{ fontWeight: 600 }}>{wh.name}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{wh.url}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {wh.events.map(ev => (
                              <Chip key={ev} label={ev} size="small" variant="outlined" />
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip label={wh.active ? 'Active' : 'Disabled'} color={wh.active ? 'success' : 'default'} size="small" />
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <IconButton size="small" title="Send Test Ping" onClick={() => testWebhook(wh.id)}>
                              <SendIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" title="Delivery History" onClick={() => viewDeliveries(wh)}>
                              <HistoryIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" title="Edit" onClick={() => openEditWebhook(wh)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" color="error" title="Delete" onClick={() => deleteWebhook(wh.id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {tab === 7 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('systemRequirements')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('systemRequirementsDesc')}
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t('toolCol')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('requiredForCol')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t('status')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[
                    { name: 'mysql', label: 'mysqldump', for: 'MySQL backups' },
                    { name: 'postgres', label: 'pg_dump', for: 'PostgreSQL backups' },
                    { name: 'oracle', label: 'expdp / impdp', for: 'Oracle backups' },
                    { name: 'mongodb', label: 'mongodump', for: 'MongoDB backups' },
                    { name: 'redis', label: 'redis-cli', for: 'Redis backups' },
                    { name: 'vmware', label: 'govc', for: 'VMware vSphere' },
                    { name: 'hyperv', label: 'PowerShell', for: 'Hyper-V backups' },
                    { name: 'aws', label: 'AWS CLI', for: 'Amazon S3' },
                    { name: 'azure', label: 'Azure CLI', for: 'Azure Blob' },
                    { name: 'gcp', label: 'gsutil', for: 'Google Cloud' },
                  ].map((tool) => {
                    const status = toolStatus(tool.name);
                    return (
                      <TableRow key={tool.name}>
                        <TableCell><Typography sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{tool.label}</Typography></TableCell>
                        <TableCell>{tool.for}</TableCell>
                        <TableCell><Chip icon={status.color === 'success' ? <CheckIcon /> : <CancelIcon />} label={status.label} size="small" color={status.color} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>{t('refresh')}</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {tab !== 6 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={save}>{t('saveSettings')}</Button>
        </Box>
      )}

      {/* Webhook Add/Edit Dialog */}
      <Dialog open={whDialogOpen} onClose={() => setWhDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingWh ? 'Edit Webhook Endpoint' : 'Add Webhook Endpoint'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Friendly Name"
            fullWidth
            value={whForm.name}
            onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
            placeholder="e.g. Chat Notification Webhook"
          />
          <TextField
            label="Payload URL"
            fullWidth
            value={whForm.url}
            onChange={(e) => setWhForm({ ...whForm, url: e.target.value })}
            placeholder="https://api.yourcompany.com/bck-receiver"
          />
          <TextField
            label="HMAC Signature Secret (Optional)"
            fullWidth
            value={whForm.secret}
            onChange={(e) => setWhForm({ ...whForm, secret: e.target.value })}
            placeholder="Enter secure webhook secret"
            helperText="If provided, payloads will contain X-BCK-Signature header"
          />
          
          <Typography variant="subtitle2" sx={{ mt: 1, fontWeight: 600 }}>Event Subscriptions</Typography>
          <FormGroup row>
            {['backup.started', 'backup.completed', 'backup.failed'].map(ev => (
              <FormControlLabel
                key={ev}
                control={<Checkbox checked={whForm.events.includes(ev)} onChange={() => handleEventToggle(ev)} />}
                label={ev}
              />
            ))}
          </FormGroup>

          <TextField
            label="Max Retry Attempts"
            type="number"
            value={whForm.retries}
            onChange={(e) => setWhForm({ ...whForm, retries: parseInt(e.target.value) || 3 })}
            inputProps={{ min: 1, max: 10 }}
            helperText="Exponential backoff retries on failure (up to 10)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWhDialogOpen(false)}>{t('cancel')}</Button>
          <Button onClick={saveWebhook} variant="contained" disabled={!whForm.name || !whForm.url}>{t('save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Webhook Delivery History Dialog */}
      <Dialog open={delDialogOpen} onClose={() => setDelDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Webhook Delivery History — {selectedWhName}</DialogTitle>
        <DialogContent>
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Event</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Time</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>HTTP Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Attempt</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Error</TableCell>
                  </TableRow>
                </TableRow>
              </TableHead>
              <TableBody>
                {deliveries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>No delivery logs recorded for this endpoint.</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  deliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell><Chip label={d.event} size="small" variant="outlined" /></TableCell>
                      <TableCell sx={{ fontSize: 13 }}>{new Date(d.deliveredAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip
                          label={d.status}
                          color={d.status === 'success' ? 'success' : 'error'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{d.statusCode || '-'}</TableCell>
                      <TableCell>{d.attempt}</TableCell>
                      <TableCell sx={{ color: 'error.main', fontSize: 12, maxWidth: 200, wordBreak: 'break-all' }}>{d.error || '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDelDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
