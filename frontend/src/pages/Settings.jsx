import { useState, useEffect, useCallback } from 'react';
import {
  Settings as SettingsIcon, Bell, Database, Shield, Sliders, Users, Globe, Wrench, 
  Moon, Save, RefreshCw, Plus, Trash2, Edit2, History, Send, CheckCircle2, 
  X, AlertCircle, Check
} from 'lucide-react';
import { useTranslation } from '../context/LangContext';
import { useAuth } from '../context/AuthContext';
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
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { t } = useTranslation();
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

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
    fetch(`${API}/api/settings`, { headers }).then(r => r.json()).then(setSettings).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/tools`, { headers }).then(r => r.json()).then(setTools).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/webhooks`, { headers }).then(r => r.json()).then(setWebhooks).catch(e => console.error('Webhooks load error:', e));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const save = async () => {
    try {
      const r = await fetch(`${API}/api/settings`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (r.ok) showSnack(t('settingsSaved') || 'Settings saved successfully', 'success');
      else throw new Error();
    } catch { showSnack(t('failedToSave') || 'Failed to save settings', 'error'); }
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
    if (!statusObj) return { label: t('loading') || 'Loading...', color: 'default' };
    return statusObj.available ? { label: t('installed') || 'Installed', color: 'success' } : { label: t('notFoundStatus') || 'Not Found', color: 'error' };
  };

  // LDAP Connection Test
  const testLdap = async () => {
    try {
      const r = await fetch(`${API}/api/auth/ldap/test`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings.ldap),
      });
      const data = await r.json();
      if (data.success) {
        showSnack(`LDAP Connection Successful! Found ${data.userCount} users.`, 'success');
      } else {
        showSnack(`LDAP Test Failed: ${data.error}`, 'error');
      }
    } catch (e) {
      showSnack(`Request failed: ${e.message}`, 'error');
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
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(whForm),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || 'Failed to save webhook');
      }
      setWhDialogOpen(false);
      showSnack('Webhook saved successfully', 'success');
      load();
    } catch (e) {
      showSnack(e.message, 'error');
    }
  };

  const deleteWebhook = async (id) => {
    if (!window.confirm('Are you sure you want to delete this webhook endpoint?')) return;
    try {
      const r = await fetch(`${API}/api/webhooks/${id}`, { method: 'DELETE', headers });
      if (r.ok) {
        showSnack('Webhook deleted', 'success');
        load();
      } else {
        throw new Error();
      }
    } catch {
      showSnack('Failed to delete webhook', 'error');
    }
  };

  const testWebhook = async (id) => {
    try {
      const r = await fetch(`${API}/api/webhooks/${id}/test`, { method: 'POST', headers });
      const data = await r.json();
      if (data.success) {
        showSnack(`Webhook test completed! Status: ${data.statusCode}`, 'success');
      } else {
        showSnack(`Webhook test failed: ${data.error || ('Status ' + data.statusCode)}`, 'warning');
      }
    } catch (e) {
      showSnack(`Test request failed: ${e.message}`, 'error');
    }
  };

  const viewDeliveries = async (wh) => {
    setSelectedWhName(wh.name);
    try {
      const r = await fetch(`${API}/api/webhooks/${wh.id}/deliveries`, { headers });
      if (r.ok) {
        const data = await r.json();
        setDeliveries(data);
        setDelDialogOpen(true);
      }
    } catch (e) {
      showSnack('Failed to load deliveries: ' + e.message, 'error');
    }
  };

  const handleEventToggle = (ev) => {
    const next = whForm.events.includes(ev)
      ? whForm.events.filter(e => e !== ev)
      : [...whForm.events, ev];
    setWhForm({ ...whForm, events: next });
  };

  const TABS = [
    { id: 0, icon: SettingsIcon, label: t('settingsGeneral') || 'General' },
    { id: 1, icon: Bell, label: t('settingsNotifications') || 'Notifications' },
    { id: 2, icon: Database, label: t('settingsRetention') || 'Retention' },
    { id: 3, icon: Shield, label: t('settingsSecurity') || 'Security' },
    { id: 4, icon: Sliders, label: t('settingsAdvanced') || 'Advanced' },
    { id: 5, icon: Users, label: t('settingsLdap') || 'LDAP / AD' },
    { id: 6, icon: Globe, label: 'Webhooks' },
    { id: 7, icon: Wrench, label: t('settingsSystemTools') || 'System Tools' },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
          {t('settingsTitle') || 'Settings'}
        </h1>
        <p className="text-sm font-medium text-slate-500">
          {t('settingsSubtitle') || 'Manage system configuration and preferences'}
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Sidebar Navigation */}
        <div className="w-full md:w-64 shrink-0 flex flex-col gap-1">
          {TABS.map(tOption => {
            const Icon = tOption.icon;
            const active = tab === tOption.id;
            return (
              <button 
                key={tOption.id}
                onClick={() => setTab(tOption.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                  active 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon size={18} className={active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'} />
                {tOption.label}
              </button>
            );
          })}
          
          {tab !== 6 && (
            <div className="mt-6">
              <button onClick={save} className="btn-primary w-full py-3 px-4 justify-center shadow-lg shadow-blue-500/20">
                <Save size={18} />
                {t('saveSettings') || 'Save Settings'}
              </button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 w-full min-w-0">
          <div className="glass-card p-6 animate-fade-in">
            
            {/* General Tab */}
            {tab === 0 && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('settingsAppearance') || 'Appearance'}
                  </h3>
                  <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-indigo-500/10 text-indigo-500 rounded-lg">
                        <Moon size={24} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{t('darkMode') || 'Dark Mode'}</p>
                        <p className="text-xs text-slate-500">{t('darkModeDesc') || 'Toggle dark mode theme'}</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={isDark} onChange={toggleTheme} />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                    </label>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('scheduleDefaults') || 'Schedule Defaults'}
                  </h3>
                  <div className="max-w-md">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('timezone') || 'Timezone'}
                    </label>
                    <select 
                      value={settings.schedule.timezone} 
                      onChange={(e) => setSettings({ ...settings, schedule: { ...settings.schedule, timezone: e.target.value } })}
                      className="input-field py-2"
                    >
                      {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Kyiv', 'Asia/Tokyo', 'Asia/Shanghai'].map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('networkAccess') || 'Network Access'}
                  </h3>
                  <div className="space-y-4 max-w-xl">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('applicationUrl') || 'Application URL'}
                      </label>
                      <input 
                        type="text" 
                        value={(settings.network && settings.network.appUrl) || ''} 
                        onChange={(e) => updateNetwork('appUrl', e.target.value)} 
                        placeholder={(settings.network && settings.network.effectiveAppUrl) || 'http://192.168.1.10:6000'}
                        className="input-field" 
                      />
                      <p className="text-xs text-slate-500 mt-1">{t('applicationUrlDesc') || 'Base URL for webhooks and links'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('bindHost') || 'Bind Host'}
                      </label>
                      <input 
                        type="text" 
                        value={(settings.network && settings.network.bindHost) || '0.0.0.0'} 
                        onChange={(e) => updateNetwork('bindHost', e.target.value)} 
                        className="input-field" 
                      />
                      <p className="text-xs text-slate-500 mt-1">{t('bindHostDesc') || '0.0.0.0 binds to all interfaces'}</p>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                          {t('detectedLocalIp') || 'Detected Local IP'}
                        </p>
                        <p className="text-sm font-mono font-bold text-slate-900 dark:text-white">
                          {(settings.network && settings.network.localIp) || '127.0.0.1'}
                        </p>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                          {t('currentAccessUrl') || 'Effective URL'}
                        </p>
                        <p className="text-sm font-mono font-bold text-slate-900 dark:text-white break-all">
                          {(settings.network && settings.network.effectiveAppUrl) || ''}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('version') || 'Version'}
                  </h3>
                  <div className="inline-flex items-center px-3 py-1 rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-sm font-bold">
                    BCK Backup Solution v1.0.0
                  </div>
                </div>
              </div>
            )}

            {/* Notifications Tab */}
            {tab === 1 && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('smtp') || 'SMTP Settings'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">SMTP Host</label>
                      <input type="text" value={settings.smtp.host} onChange={(e) => updateSMTP('host', e.target.value)} placeholder="smtp.gmail.com" className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('port') || 'Port'}</label>
                      <input type="number" value={settings.smtp.port} onChange={(e) => updateSMTP('port', parseInt(e.target.value))} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('encryption') || 'Encryption'}</label>
                      <select value={settings.smtp.encryption} onChange={(e) => updateSMTP('encryption', e.target.value)} className="input-field py-2">
                        <option value="tls">TLS</option>
                        <option value="ssl">SSL</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">From Address</label>
                      <input type="text" value={settings.smtp.from} onChange={(e) => updateSMTP('from', e.target.value)} placeholder="backup@example.com" className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('username') || 'Username'}</label>
                      <input type="text" value={settings.smtp.user} onChange={(e) => updateSMTP('user', e.target.value)} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('password') || 'Password'}</label>
                      <input type="password" value={settings.smtp.password} onChange={(e) => updateSMTP('password', e.target.value)} className="input-field" />
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <label className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer">
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{t('emailOnFailure') || 'Email on Failure'}</p>
                        <p className="text-xs text-slate-500">{t('emailOnFailureDesc') || 'Send email when a backup fails'}</p>
                      </div>
                      <div className="relative inline-flex items-center">
                        <input type="checkbox" className="sr-only peer" checked={settings.notifications.email} onChange={(e) => updateNotifications('email', e.target.checked)} />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                      </div>
                    </label>
                    <label className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer">
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{t('emailOnSuccess') || 'Email on Success'}</p>
                        <p className="text-xs text-slate-500">{t('emailOnSuccessDesc') || 'Send email when a backup succeeds'}</p>
                      </div>
                      <div className="relative inline-flex items-center">
                        <input type="checkbox" className="sr-only peer" checked={settings.notifications.emailOnSuccess} onChange={(e) => updateNotifications('emailOnSuccess', e.target.checked)} />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Slack</h3>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('slackWebhook') || 'Slack Webhook URL'}</label>
                    <input type="text" value={settings.notifications.slack} onChange={(e) => updateNotifications('slack', e.target.value)} placeholder="https://hooks.slack.com/services/..." className="input-field" />
                    <p className="text-xs text-slate-500 mt-1">{t('slackDesc') || 'Receive notifications in a Slack channel'}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Discord</h3>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('discordWebhook') || 'Discord Webhook URL'}</label>
                    <input type="text" value={settings.notifications.discord} onChange={(e) => updateNotifications('discord', e.target.value)} placeholder="https://discord.com/api/webhooks/..." className="input-field" />
                    <p className="text-xs text-slate-500 mt-1">{t('discordDesc') || 'Receive notifications in a Discord channel'}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Telegram</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('telegramBotToken') || 'Bot Token'}</label>
                        <input type="text" value={settings.notifications.telegramBotToken} onChange={(e) => updateNotifications('telegramBotToken', e.target.value)} placeholder="123456:ABC-def" className="input-field" />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('telegramChatId') || 'Chat ID'}</label>
                        <input type="text" value={settings.notifications.telegram} onChange={(e) => updateNotifications('telegram', e.target.value)} placeholder="-1001234567890" className="input-field" />
                      </div>
                      <p className="text-xs text-slate-500">{t('telegramDesc') || 'Receive notifications via Telegram Bot'}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">{t('genericWebhook') || 'Generic Webhook'}</h3>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('webhookUrl') || 'Webhook URL'}</label>
                    <input type="text" value={settings.notifications.webhook} onChange={(e) => updateNotifications('webhook', e.target.value)} placeholder="https://your-server.com/webhook" className="input-field" />
                    <p className="text-xs text-slate-500 mt-1">{t('genericWebhookDesc') || 'Simple HTTP POST for backward compatibility'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Retention Tab */}
            {tab === 2 && (
              <div className="max-w-xl space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('retentionPolicies') || 'Retention Policies'}
                  </h3>
                  
                  <label className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer mb-6">
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{t('enableRetentionPolicy') || 'Enable Retention Policy'}</p>
                      <p className="text-xs text-slate-500">{t('enableRetentionPolicyDesc') || 'Automatically delete old backups'}</p>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input type="checkbox" className="sr-only peer" checked={settings.retention.enabled} onChange={(e) => updateRetention('enabled', e.target.checked)} />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                    </div>
                  </label>
                  
                  <div className={`space-y-4 transition-opacity ${!settings.retention.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('keepBackupsForDays') || 'Keep backups for (days)'}</label>
                      <input type="number" min="1" value={settings.retention.days} onChange={(e) => updateRetention('days', parseInt(e.target.value) || 0)} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('minCopiesToKeep') || 'Minimum copies to keep'}</label>
                      <input type="number" min="1" value={settings.retention.copies} onChange={(e) => updateRetention('copies', parseInt(e.target.value) || 0)} className="input-field" />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2 mt-8">
                    {t('storage') || 'Storage Limits'}
                  </h3>
                  
                  <label className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer mb-6">
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{t('limitStorageUsage') || 'Limit Storage Usage'}</p>
                      <p className="text-xs text-slate-500">{t('limitStorageUsageDesc') || 'Delete oldest backups if limit is reached'}</p>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input type="checkbox" className="sr-only peer" checked={settings.retention.customLimitEnabled || false} onChange={(e) => updateRetention('customLimitEnabled', e.target.checked)} />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                    </div>
                  </label>
                  
                  <div className={`transition-opacity ${!settings.retention.customLimitEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('customStorageLimit') || 'Custom Storage Limit (GB)'}</label>
                    <input type="number" min="1" value={settings.retention.customLimitGB || 50} onChange={(e) => updateRetention('customLimitGB', parseInt(e.target.value) || 0)} className="input-field" />
                  </div>
                </div>
              </div>
            )}

            {/* Security Tab */}
            {tab === 3 && (
              <div className="max-w-xl space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('settingsSecurity') || 'Security Settings'}
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('sessionTimeout') || 'Session Timeout (minutes)'}</label>
                      <input type="number" min="5" value={(settings.security && settings.security.sessionTimeout) || 60} onChange={(e) => updateSecurity('sessionTimeout', parseInt(e.target.value) || 0)} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('minPasswordLength') || 'Minimum Password Length'}</label>
                      <input type="number" min="6" value={(settings.security && settings.security.minPasswordLength) || 6} onChange={(e) => updateSecurity('minPasswordLength', parseInt(e.target.value) || 0)} className="input-field" />
                    </div>
                    
                    <label className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer mt-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{t('preventConcurrent') || 'Prevent Concurrent Sessions'}</p>
                        <p className="text-xs text-slate-500">Only allow one active session per user</p>
                      </div>
                      <div className="relative inline-flex items-center">
                        <input type="checkbox" className="sr-only peer" checked={(settings.security && settings.security.preventConcurrent) || false} onChange={(e) => updateSecurity('preventConcurrent', e.target.checked)} />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Advanced Tab */}
            {tab === 4 && (
              <div className="max-w-xl space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('settingsAdvanced') || 'Advanced Settings'}
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('tempPath') || 'Temporary Path'}</label>
                      <input type="text" value={(settings.advanced && settings.advanced.tempPath) || ''} onChange={(e) => updateAdvanced('tempPath', e.target.value)} placeholder="e.g. C:\temp or /tmp" className="input-field" />
                      <p className="text-xs text-slate-500 mt-1">Directory used for intermediate backup files</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('bandwidthLimit') || 'Bandwidth Limit (KB/s)'}</label>
                      <input type="number" min="0" value={(settings.advanced && settings.advanced.bandwidthLimit) || 0} onChange={(e) => updateAdvanced('bandwidthLimit', parseInt(e.target.value) || 0)} className="input-field" />
                      <p className="text-xs text-slate-500 mt-1">0 means no limit (unlimited)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('compressionLevel') || 'Compression Level'}</label>
                      <select value={(settings.advanced && settings.advanced.compressionLevel) || 'medium'} onChange={(e) => updateAdvanced('compressionLevel', e.target.value)} className="input-field py-2">
                        <option value="none">{t('compressionNone') || 'None'}</option>
                        <option value="low">{t('compressionLow') || 'Low (Faster)'}</option>
                        <option value="medium">{t('compressionMedium') || 'Medium (Balanced)'}</option>
                        <option value="high">{t('compressionHigh') || 'High (Smaller file)'}</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* LDAP Tab */}
            {tab === 5 && (
              <div className="max-w-xl space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {t('settingsLdap') || 'LDAP / Active Directory Integration'}
                  </h3>
                  
                  <label className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer mb-6">
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{t('ldapEnabled') || 'Enable LDAP Auth'}</p>
                      <p className="text-xs text-slate-500">Allow users to log in using AD/LDAP credentials</p>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input type="checkbox" className="sr-only peer" checked={(settings.ldap && settings.ldap.enabled) || false} onChange={(e) => updateLDAP('enabled', e.target.checked)} />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                    </div>
                  </label>
                  
                  <div className={`space-y-4 transition-opacity ${!(settings.ldap && settings.ldap.enabled) ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('ldapServerUrl') || 'Server URL'}</label>
                      <input type="text" value={(settings.ldap && settings.ldap.url) || ''} onChange={(e) => updateLDAP('url', e.target.value)} placeholder="ldap://localhost:389" className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('ldapBaseDn') || 'Base DN'}</label>
                      <input type="text" value={(settings.ldap && settings.ldap.baseDn) || ''} onChange={(e) => updateLDAP('baseDn', e.target.value)} placeholder="dc=example,dc=org" className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('ldapBindDn') || 'Bind DN'}</label>
                      <input type="text" value={(settings.ldap && settings.ldap.bindDn) || ''} onChange={(e) => updateLDAP('bindDn', e.target.value)} placeholder="cn=admin,dc=example,dc=org" className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('ldapBindPassword') || 'Bind Password'}</label>
                      <input type="password" value={(settings.ldap && settings.ldap.bindPassword) || ''} onChange={(e) => updateLDAP('bindPassword', e.target.value)} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('ldapUserFilter') || 'User Filter'}</label>
                      <input type="text" value={(settings.ldap && settings.ldap.userFilter) || ''} onChange={(e) => updateLDAP('userFilter', e.target.value)} placeholder="(sAMAccountName={{username}})" className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('ldapGroupMapping') || 'Group Mapping (JSON)'}</label>
                      <textarea rows="3" value={(settings.ldap && settings.ldap.groupMapping) || ''} onChange={(e) => updateLDAP('groupMapping', e.target.value)} placeholder='{ "CN=Admins,CN=Users,DC=example,DC=org": "admin" }' className="input-field font-mono text-sm resize-none"></textarea>
                      <p className="text-xs text-slate-500 mt-1">Map LDAP/AD Groups to BCK Roles (admin, operator, viewer)</p>
                    </div>
                    
                    <div className="pt-2">
                      <button type="button" onClick={testLdap} className="btn-secondary px-5 py-2">
                        {t('testConnection') || 'Test Connection'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Webhooks Tab */}
            {tab === 6 && (
              <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1 border-none pb-0">
                      Outgoing Webhook Endpoints
                    </h3>
                    <p className="text-sm text-slate-500">Configure endpoints to receive HTTP POST payloads when backup events occur.</p>
                  </div>
                  <button onClick={openAddWebhook} className="btn-primary py-2 px-4 shrink-0">
                    <Plus size={16} />
                    Add Endpoint
                  </button>
                </div>
                
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                        <th className="p-4 font-semibold">Name</th>
                        <th className="p-4 font-semibold">URL</th>
                        <th className="p-4 font-semibold">Events</th>
                        <th className="p-4 font-semibold">Status</th>
                        <th className="p-4 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                      {webhooks.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-12 text-center text-slate-500">
                            <Globe size={48} className="mx-auto mb-4 opacity-20" />
                            <p className="text-sm font-medium">No webhook endpoints configured</p>
                          </td>
                        </tr>
                      ) : webhooks.map(wh => (
                        <tr key={wh.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                          <td className="p-4 font-bold text-slate-900 dark:text-white text-sm">{wh.name}</td>
                          <td className="p-4 text-xs font-mono text-slate-600 dark:text-slate-400 truncate max-w-[250px]" title={wh.url}>{wh.url}</td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-1">
                              {wh.events.map(ev => (
                                <span key={ev} className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700">
                                  {ev}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-4">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                              wh.active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-slate-500/10 text-slate-600 border-slate-500/20'
                            }`}>
                              {wh.active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td className="p-4 text-right whitespace-nowrap">
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => testWebhook(wh.id)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title="Send Test Ping">
                                <Send size={18} />
                              </button>
                              <button onClick={() => viewDeliveries(wh)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title="Delivery History">
                                <History size={18} />
                              </button>
                              <button onClick={() => openEditWebhook(wh)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title="Edit">
                                <Edit2 size={18} />
                              </button>
                              <button onClick={() => deleteWebhook(wh.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title="Delete">
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* System Tools Tab */}
            {tab === 7 && (
              <div>
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    {t('systemRequirements') || 'System Requirements'}
                  </h3>
                  <button onClick={load} className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>
                <p className="text-sm text-slate-500 mb-6">
                  {t('systemRequirementsDesc') || 'External tools required for specific backup types to function properly.'}
                </p>
                
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                        <th className="p-4 font-semibold">{t('toolCol') || 'Tool'}</th>
                        <th className="p-4 font-semibold">{t('requiredForCol') || 'Required For'}</th>
                        <th className="p-4 font-semibold">{t('status') || 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
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
                      ].map(tool => {
                        const status = toolStatus(tool.name);
                        const isInstalled = status.color === 'success';
                        return (
                          <tr key={tool.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                            <td className="p-4 font-mono text-sm font-bold text-slate-700 dark:text-slate-300">
                              {tool.label}
                            </td>
                            <td className="p-4 text-sm text-slate-600 dark:text-slate-400">
                              {tool.for}
                            </td>
                            <td className="p-4">
                              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full ${
                                isInstalled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                              }`}>
                                {isInstalled ? <Check size={14} /> : <X size={14} />}
                                {status.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
          </div>
        </div>
      </div>

      {/* Webhook Add/Edit Dialog */}
      {whDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 my-8 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Globe size={20} className="text-blue-500" />
                {editingWh ? 'Edit Webhook Endpoint' : 'Add Webhook Endpoint'}
              </h2>
              <button onClick={() => setWhDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-slate-100 dark:bg-slate-800 p-1.5 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Friendly Name</label>
                <input type="text" value={whForm.name} onChange={e => setWhForm({...whForm, name: e.target.value})} placeholder="e.g. Chat Notification Webhook" className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Payload URL</label>
                <input type="text" value={whForm.url} onChange={e => setWhForm({...whForm, url: e.target.value})} placeholder="https://api.yourcompany.com/bck-receiver" className="input-field font-mono text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">HMAC Signature Secret (Optional)</label>
                <input type="text" value={whForm.secret} onChange={e => setWhForm({...whForm, secret: e.target.value})} placeholder="Enter secure webhook secret" className="input-field font-mono text-sm" />
                <p className="text-xs text-slate-500 mt-1">If provided, payloads will contain X-BCK-Signature header</p>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Event Subscriptions</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                  {['backup.started', 'backup.completed', 'backup.failed'].map(ev => (
                    <label key={ev} className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center">
                        <input 
                          type="checkbox" 
                          className="sr-only peer"
                          checked={whForm.events.includes(ev)}
                          onChange={() => handleEventToggle(ev)}
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                        {ev}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Max Retry Attempts</label>
                <input type="number" min="1" max="10" value={whForm.retries} onChange={e => setWhForm({...whForm, retries: parseInt(e.target.value) || 3})} className="input-field" />
                <p className="text-xs text-slate-500 mt-1">Exponential backoff retries on failure (up to 10)</p>
              </div>
            </div>
            
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={() => setWhDialogOpen(false)} className="btn-secondary px-5 py-2">
                Cancel
              </button>
              <button type="button" onClick={saveWebhook} disabled={!whForm.name || !whForm.url} className="btn-primary px-6 py-2 disabled:opacity-50">
                Save Webhook
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Webhook Delivery History Dialog */}
      {delDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl border border-slate-200 dark:border-slate-800 my-8 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <History size={20} className="text-blue-500" />
                Delivery History — {selectedWhName}
              </h2>
              <button onClick={() => setDelDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-slate-100 dark:bg-slate-800 p-1.5 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur z-10 shadow-sm border-b border-slate-200 dark:border-slate-700">
                  <tr className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                    <th className="p-4 font-semibold">Event</th>
                    <th className="p-4 font-semibold">Time</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">HTTP Status</th>
                    <th className="p-4 font-semibold">Attempt</th>
                    <th className="p-4 font-semibold">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {deliveries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-500">
                        <History size={48} className="mx-auto mb-4 opacity-20" />
                        <p className="text-sm font-medium">No delivery logs recorded for this endpoint.</p>
                      </td>
                    </tr>
                  ) : deliveries.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-4">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700">
                          {d.event}
                        </span>
                      </td>
                      <td className="p-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                        {new Date(d.deliveredAt).toLocaleString()}
                      </td>
                      <td className="p-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                          d.status === 'success' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-red-500/10 text-red-600 border-red-500/20'
                        }`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="p-4 text-sm font-bold text-slate-700 dark:text-slate-300">
                        {d.statusCode || '-'}
                      </td>
                      <td className="p-4 text-sm text-slate-600 dark:text-slate-400 font-medium">
                        {d.attempt}
                      </td>
                      <td className="p-4 text-xs font-mono text-red-500 max-w-[200px] truncate" title={d.error}>
                        {d.error || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-end shrink-0">
              <button type="button" onClick={() => setDelDialogOpen(false)} className="btn-secondary px-5 py-2">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snackbar */}
      {snack.open && (
        <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border ${
            snack.type === 'error' ? 'bg-red-500 text-white border-red-600 shadow-red-500/20' : 
            snack.type === 'warning' ? 'bg-amber-500 text-white border-amber-600 shadow-amber-500/20' : 
            snack.type === 'info' ? 'bg-blue-500 text-white border-blue-600 shadow-blue-500/20' :
            'bg-slate-900 text-white border-slate-800 shadow-slate-900/20'
          }`}>
            {snack.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span className="text-sm font-semibold">{snack.msg}</span>
            <button onClick={() => setSnack({...snack, open: false})} className="ml-2 text-white/70 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
