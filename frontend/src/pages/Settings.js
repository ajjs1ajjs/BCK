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

const API = process.env.REACT_APP_API_URL || '';

export default function Settings({ toggleTheme, isDark }) {
  const [tab, setTab] = useState(0);
  const [settings, setSettings] = useState({
    smtp: { host: '', port: 587, user: '', password: '', from: '', encryption: 'tls' },
    retention: { enabled: true, days: 30, copies: 10 },
    notifications: { email: false, emailOnSuccess: false, slack: '', discord: '', telegram: '', telegramBotToken: '', webhook: '' },
    schedule: { timezone: 'UTC' },
  });
  const [tools, setTools] = useState({});
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });

  const load = useCallback(() => {
    fetch(`${API}/api/settings`).then(r => r.json()).then(setSettings).catch(() => {});
    fetch(`${API}/api/tools`).then(r => r.json()).then(setTools).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      const r = await fetch(`${API}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (r.ok) setSnack({ open: true, msg: 'Settings saved', severity: 'success' });
      else throw new Error();
    } catch { setSnack({ open: true, msg: 'Failed to save', severity: 'error' }); }
  };

  const updateSMTP = (k, v) => setSettings({ ...settings, smtp: { ...settings.smtp, [k]: v } });
  const updateRetention = (k, v) => setSettings({ ...settings, retention: { ...settings.retention, [k]: v } });
  const updateNotifications = (k, v) => setSettings({ ...settings, notifications: { ...settings.notifications, [k]: v } });

  const toolStatus = (name) => {
    const t = tools[name];
    if (!t) return { label: 'Checking...', color: 'default' };
    return t.available ? { label: 'Installed', color: 'success' } : { label: 'Not found', color: 'error' };
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>Settings</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Application configuration and system tools
      </Typography>

      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label="General" />
        <Tab label="Notifications" />
        <Tab label="Retention" />
        <Tab label="System Tools" />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Appearance</Typography>
                <List disablePadding>
                  <ListItem sx={{ px: 0 }}>
                    <DarkModeIcon sx={{ mr: 2, color: 'text.secondary' }} />
                    <ListItemText primary="Dark Mode" secondary="Toggle dark/light theme" />
                    <Switch checked={isDark} onChange={toggleTheme} />
                  </ListItem>
                </List>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Schedule Defaults</Typography>
                <TextField select label="Timezone" fullWidth value={settings.schedule.timezone}
                  onChange={(e) => setSettings({ ...settings, schedule: { ...settings.schedule, timezone: e.target.value } })}>
                  {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Kyiv', 'Asia/Tokyo', 'Asia/Shanghai'].map(tz => (
                    <MenuItem key={tz} value={tz}>{tz}</MenuItem>
                  ))}
                </TextField>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary">Version</Typography>
                  <Typography>BCK Backup Solution v1.0.0</Typography>
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
                <Typography variant="h6" sx={{ mb: 2 }}>SMTP (Email)</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField label="SMTP Host" fullWidth value={settings.smtp.host} onChange={(e) => updateSMTP('host', e.target.value)} placeholder="smtp.gmail.com" />
                  <TextField label="Port" type="number" fullWidth value={settings.smtp.port} onChange={(e) => updateSMTP('port', parseInt(e.target.value))} />
                  <TextField select label="Encryption" fullWidth value={settings.smtp.encryption} onChange={(e) => updateSMTP('encryption', e.target.value)}>
                    <MenuItem value="tls">TLS</MenuItem>
                    <MenuItem value="ssl">SSL</MenuItem>
                    <MenuItem value="none">None</MenuItem>
                  </TextField>
                  <TextField label="Username" fullWidth value={settings.smtp.user} onChange={(e) => updateSMTP('user', e.target.value)} />
                  <TextField label="Password" type="password" fullWidth value={settings.smtp.password} onChange={(e) => updateSMTP('password', e.target.value)} />
                  <TextField label="From address" fullWidth value={settings.smtp.from} onChange={(e) => updateSMTP('from', e.target.value)} placeholder="backup@example.com" />
                </Box>
                <List disablePadding sx={{ mt: 2 }}>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText primary="Email on failure" secondary="Send email when backup fails" />
                    <Switch checked={settings.notifications.email} onChange={(e) => updateNotifications('email', e.target.checked)} />
                  </ListItem>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText primary="Email on success" secondary="Send email when backup completes" />
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
                <TextField label="Slack Webhook URL" fullWidth value={settings.notifications.slack}
                  onChange={(e) => updateNotifications('slack', e.target.value)}
                  placeholder="https://hooks.slack.com/services/..." />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Create an Incoming Webhook in Slack Apps
                </Typography>
              </CardContent>
            </Card>

            <Card sx={{ mb: 2.5 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Discord</Typography>
                <TextField label="Discord Webhook URL" fullWidth value={settings.notifications.discord}
                  onChange={(e) => updateNotifications('discord', e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..." />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Create a Webhook in Discord channel settings
                </Typography>
              </CardContent>
            </Card>

            <Card sx={{ mb: 2.5 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Telegram</Typography>
                <TextField label="Bot Token" fullWidth value={settings.notifications.telegramBotToken}
                  onChange={(e) => updateNotifications('telegramBotToken', e.target.value)}
                  placeholder="123456:ABC-def" />
                <TextField label="Chat ID" fullWidth value={settings.notifications.telegram}
                  onChange={(e) => updateNotifications('telegram', e.target.value)}
                  placeholder="-1001234567890" sx={{ mt: 2 }} />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Get token from @BotFather, chat ID from @userinfobot
                </Typography>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Generic Webhook</Typography>
                <TextField label="Webhook URL" fullWidth value={settings.notifications.webhook}
                  onChange={(e) => updateNotifications('webhook', e.target.value)}
                  placeholder="https://your-server.com/webhook" />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  POST JSON payload to any HTTP endpoint
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {tab === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Retention Policy</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 400 }}>
              <List disablePadding>
                <ListItem sx={{ px: 0 }}>
                  <ListItemText primary="Enable retention policy" secondary="Automatically clean up old backups" />
                  <Switch checked={settings.retention.enabled} onChange={(e) => updateRetention('enabled', e.target.checked)} />
                </ListItem>
              </List>
              <TextField label="Keep backups for (days)" type="number" fullWidth value={settings.retention.days}
                onChange={(e) => updateRetention('days', parseInt(e.target.value))} disabled={!settings.retention.enabled} />
              <TextField label="Minimum copies to keep" type="number" fullWidth value={settings.retention.copies}
                onChange={(e) => updateRetention('copies', parseInt(e.target.value))} disabled={!settings.retention.enabled} />
            </Box>
          </CardContent>
        </Card>
      )}

      {tab === 3 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>System Requirements</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Check which CLI tools are available on this server. Required for database, VM, and cloud backups.
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Tool</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Required For</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[
                    { name: 'mysql', label: 'mysqldump', for: 'MySQL backups' },
                    { name: 'postgres', label: 'pg_dump', for: 'PostgreSQL backups' },
                    { name: 'oracle', label: 'expdp / impdp', for: 'Oracle backups' },
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
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={save}>Save Settings</Button>
      </Box>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
