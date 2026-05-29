import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Switch, List, ListItem,
  ListItemText, Snackbar, Alert, Grid, MenuItem, Chip, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import {
  DarkMode as DarkModeIcon, Save as SaveIcon, Refresh as RefreshIcon,
  CheckCircle as CheckIcon, Cancel as CancelIcon,
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
  });
  const [tools, setTools] = useState({});
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/settings`).then(r => r.json()).then(setSettings).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/tools`).then(r => r.json()).then(setTools).catch(e => console.error('Load error:', e));
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

  const toolStatus = (name) => {
    const statusObj = tools[name];
    if (!statusObj) return { label: t('loading'), color: 'default' };
    return statusObj.available ? { label: t('installed'), color: 'success' } : { label: t('notFoundStatus'), color: 'error' };
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

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={save}>{t('saveSettings')}</Button>
      </Box>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
