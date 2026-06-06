import { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Trash2, Edit2, Play, RefreshCw, Server, AlertCircle, 
  CheckCircle2, PlayCircle, X, Terminal, Database
} from 'lucide-react';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

const EMPTY_FORM = {
  name: '', destination: '/backup/ssh', backupType: 'ssh',
  config: { sshConnectionId: '', sourcePath: '/', excludes: '/dev\n/proc\n/sys\n/run\n/tmp', cloudCredentialId: '' },
};

export default function SshBackups() {
  const [backups, setBackups] = useState([]);
  const [sshConns, setSshConns] = useState([]);
  const [cloudCreds, setCloudCreds] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connDialogOpen, setConnDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [connForm, setConnForm] = useState({ name: '', host: '', port: 22, user: '', password: '', key: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { t, lang } = useTranslation();
  const isUk = lang === 'uk';

  const load = useCallback(() => {
    fetch(`${API}/api/backups?type=ssh`)
      .then(r => r.json())
      .then(data => setBackups(data?.data || (Array.isArray(data) ? data : [])))
      .catch(e => console.error('Load error:', e));
    fetch(`${API}/api/ssh-connections`)
      .then(r => r.json())
      .then(data => setSshConns(Array.isArray(data) ? data : []))
      .catch(e => console.error('Load error:', e));
    fetch(`${API}/api/cloud-credentials`)
      .then(r => r.json())
      .then(data => setCloudCreds(Array.isArray(data) ? data : []))
      .catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (backup) => {
    setEditing(backup);
    setForm({
      name: backup.name || '',
      destination: backup.destination || '/backup/ssh',
      backupType: backup.backupType || 'ssh',
      config: { ...EMPTY_FORM.config, ...backup.config, sourcePath: backup.config?.sourcePath || backup.source || '/' },
    });
    setDialogOpen(true);
  };

  const saveBackup = async (e) => {
    e.preventDefault();
    if (!form.name || !form.config.sshConnectionId || !form.destination) {
      showSnack(isUk ? 'Назва, SSH зʼєднання і сховище обовʼязкові' : 'Name, SSH connection, and destination required', 'warning');
      return;
    }

    const excludes = (form.config.excludes || '').split('\n').map(s => s.trim()).filter(Boolean);
    const payload = {
      name: form.name,
      source: form.config.sourcePath || '/',
      destination: form.destination,
      type: 'full',
      backupType: form.backupType,
      config: { ...form.config, excludes },
    };

    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;

    try {
      const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (resp.ok) {
        showSnack(isUk ? 'Збережено' : 'Saved', 'success');
        setDialogOpen(false);
        load();
      } else {
        const err = await resp.json();
        showSnack(err.error || 'Error', 'error');
      }
    } catch { showSnack('Network error', 'error'); }
  };

  const runBackup = async (id) => {
    try {
      const resp = await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
      const data = await resp.json();
      showSnack(data.message || 'Started', 'success');
      load();
    } catch { showSnack('Error', 'error'); }
  };

  const deleteBackup = async (id) => {
    if (!window.confirm(isUk ? 'Видалити?' : 'Delete?')) return;
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' });
      showSnack(isUk ? 'Видалено' : 'Deleted', 'success');
      load();
    } catch { showSnack('Error', 'error'); }
  };

  const saveConnection = async (e) => {
    e.preventDefault();
    if (!connForm.name || !connForm.host || !connForm.user) return;
    try {
      const resp = await fetch(`${API}/api/ssh-connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(connForm) });
      if (resp.ok) {
        setConnDialogOpen(false);
        setConnForm({ name: '', host: '', port: 22, user: '', password: '', key: '' });
        load();
        showSnack(isUk ? 'З\'єднання додано' : 'Connection added', 'success');
      }
    } catch { showSnack('Error saving SSH connection', 'error'); }
  };

  const deleteConnection = async (id) => {
    if (!window.confirm(isUk ? 'Видалити з\'єднання?' : 'Delete connection?')) return;
    try { await fetch(`${API}/api/ssh-connections/${id}`, { method: 'DELETE' }); load(); showSnack('Deleted', 'success'); } catch { showSnack('Error deleting connection', 'error'); }
  };

  const testConnection = async (id) => {
    try {
      const resp = await fetch(`${API}/api/ssh-connections/${id}/test`, { method: 'POST' });
      const data = await resp.json();
      showSnack(data.success ? (isUk ? `Підключено до ${data.hostname}` : `Connected to ${data.hostname}`) : (data.error || 'Failed'), data.success ? 'success' : 'error');
    } catch { showSnack('Error testing connection', 'error'); }
  };

  const getStatusStyle = (status) => {
    switch(status) {
      case 'completed': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
      case 'failed': return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'running': return 'bg-blue-500/10 text-blue-600 border-blue-500/20 animate-pulse';
      case 'pending': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      default: return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {isUk ? 'SSH бекапи' : 'SSH Backups'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {isUk ? 'Резервне копіювання віддалених серверів через SSH' : 'Remote server backups via SSH'}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={() => setConnDialogOpen(true)} className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
            <Server size={18} />
            {isUk ? 'Додати з\'єднання' : 'Add Connection'}
          </button>
          <button onClick={openCreate} className="btn-primary py-2.5 px-4 flex-1 sm:flex-none">
            <Plus size={18} />
            {isUk ? 'Створити' : 'Create'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SSH Connections Panel */}
        <div className="lg:col-span-1">
          <div className="glass-card h-full flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
              <h2 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Terminal size={18} className="text-blue-500" />
                {isUk ? 'SSH з\'єднання' : 'SSH Connections'}
              </h2>
            </div>
            
            <div className="flex-1 p-2">
              {sshConns.length === 0 ? (
                <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center h-full">
                  <Server size={32} className="opacity-20 mb-3" />
                  <p className="text-sm">{isUk ? 'Немає з\'єднань. Додайте нове.' : 'No connections. Add one.'}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sshConns.map(c => (
                    <div key={c.id} className="group p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 hover:border-blue-500/30 transition-all flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-sm text-slate-900 dark:text-white mb-0.5">{c.name}</div>
                        <div className="text-xs text-slate-500 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded inline-block">
                          {c.user}@{c.host}:{c.port}
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => testConnection(c.id)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title="Test Connection">
                          <Play size={16} />
                        </button>
                        <button onClick={() => deleteConnection(c.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title="Delete">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Backups Panel */}
        <div className="lg:col-span-2">
          <div className="glass-card h-full">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
              <h2 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Database size={18} className="text-purple-500" />
                {t('backups') || 'Backups'}
              </h2>
              <button onClick={load} className="btn-secondary px-3 py-1.5 text-sm" title={t('refresh')}>
                <RefreshCw size={16} /> {t('refresh') || 'Refresh'}
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                    <th className="p-4 font-semibold">{t('name')}</th>
                    <th className="p-4 font-semibold">SSH</th>
                    <th className="p-4 font-semibold">{t('status')}</th>
                    <th className="p-4 font-semibold">{t('created') || 'Created'}</th>
                    <th className="p-4 font-semibold text-right">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="p-8 text-center text-slate-500">
                        <Terminal size={48} className="mx-auto mb-4 opacity-20" />
                        <p className="text-sm font-medium">{t('noBackupsConfigured')}</p>
                      </td>
                    </tr>
                  ) : (
                    backups.map(b => (
                      <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                        <td className="p-4">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{b.name}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{b.backupType === 'ssh-db' ? 'Database' : 'Filesystem'}</p>
                        </td>
                        <td className="p-4">
                          <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {b.config?.sshConnectionId ? sshConns.find(c => c.id === b.config.sshConnectionId)?.name || 'SSH' : 'SSH'}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider whitespace-nowrap ${getStatusStyle(b.status)}`}>
                            {b.status || 'unknown'}
                          </span>
                        </td>
                        <td className="p-4">
                          <p className="text-xs font-medium text-slate-500">
                            {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '-'}
                          </p>
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => runBackup(b.id)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('runNow')}>
                              <PlayCircle size={18} />
                            </button>
                            <button onClick={() => openEdit(b)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title={t('edit')}>
                              <Edit2 size={18} />
                            </button>
                            <button onClick={() => deleteBackup(b.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete')}>
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Backup Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {editing ? t('editBackup') : t('addBackup')}
              </h2>
              <button onClick={() => setDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={saveBackup}>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('name')}</label>
                  <input type="text" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">SSH Connection</label>
                  <select required value={form.config.sshConnectionId} onChange={e => setForm({...form, config: {...form.config, sshConnectionId: e.target.value}})} className="input-field">
                    <option value="" disabled>Select connection</option>
                    {sshConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.user}@{c.host})</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Тип бекапу' : 'Backup Type'}</label>
                  <select value={form.backupType} onChange={e => setForm({...form, backupType: e.target.value})} className="input-field">
                    <option value="ssh">{isUk ? 'Файлова система (tar)' : 'Filesystem (tar)'}</option>
                    <option value="ssh-db">{isUk ? 'База даних (віддалено)' : 'Database (remote)'}</option>
                  </select>
                </div>

                {form.backupType === 'ssh-db' ? (
                  <div className="space-y-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Тип БД' : 'DB Type'}</label>
                        <select value={form.config.dbType || 'mysql'} onChange={e => setForm({...form, config: {...form.config, dbType: e.target.value}})} className="input-field py-1.5 text-sm">
                          <option value="mysql">MySQL / MariaDB</option>
                          <option value="postgres">PostgreSQL</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'База даних' : 'Database'}</label>
                        <input type="text" value={form.config.database || ''} onChange={e => setForm({...form, config: {...form.config, database: e.target.value}})} className="input-field py-1.5 text-sm" placeholder="my_db" />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Хост БД' : 'DB Host'}</label>
                        <input type="text" value={form.config.dbHost || 'localhost'} onChange={e => setForm({...form, config: {...form.config, dbHost: e.target.value}})} className="input-field py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Порт БД' : 'DB Port'}</label>
                        <input type="number" value={form.config.dbPort || ''} onChange={e => setForm({...form, config: {...form.config, dbPort: e.target.value}})} className="input-field py-1.5 text-sm" placeholder="Default" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Користувач БД' : 'DB User'}</label>
                        <input type="text" value={form.config.dbUser || ''} onChange={e => setForm({...form, config: {...form.config, dbUser: e.target.value}})} className="input-field py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Пароль БД' : 'DB Password'}</label>
                        <input type="password" value={form.config.dbPassword || ''} onChange={e => setForm({...form, config: {...form.config, dbPassword: e.target.value}})} className="input-field py-1.5 text-sm" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Шлях на віддаленому сервері' : 'Remote Source Path'}</label>
                      <input type="text" value={form.config.sourcePath} onChange={e => setForm({...form, config: {...form.config, sourcePath: e.target.value}})} className="input-field font-mono text-sm" placeholder="/" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Виключення (по одному на рядок)' : 'Excludes (one per line)'}</label>
                      <textarea rows={4} value={form.config.excludes} onChange={e => setForm({...form, config: {...form.config, excludes: e.target.value}})} className="input-field font-mono text-sm resize-none" />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Сховище (локальна тека)' : 'Destination (local path)'}</label>
                  <input type="text" required value={form.destination} onChange={e => setForm({...form, destination: e.target.value})} className="input-field font-mono text-sm" placeholder="/backup/ssh" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Завантажити в хмару (опціонально)' : 'Upload to Cloud (optional)'}</label>
                  <select value={form.config.cloudCredentialId || ''} onChange={e => setForm({...form, config: {...form.config, cloudCredentialId: e.target.value}})} className="input-field">
                    <option value="">{isUk ? 'Ні — тільки локально' : 'None — local only'}</option>
                    {cloudCreds.map(c => <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>)}
                  </select>
                </div>
              </div>
              
              <div className="flex justify-end gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setDialogOpen(false)} className="btn-secondary px-4 py-2">
                  {t('cancel')}
                </button>
                <button type="submit" className="btn-primary px-6 py-2">
                  {editing ? t('save') : t('create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Connection Dialog */}
      {connDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {isUk ? 'Нове SSH з\'єднання' : 'New SSH Connection'}
              </h2>
              <button onClick={() => setConnDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={saveConnection}>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('name')}</label>
                  <input type="text" required value={connForm.name} onChange={e => setConnForm({...connForm, name: e.target.value})} className="input-field" placeholder="My Server" />
                </div>
                
                <div className="grid grid-cols-4 gap-4">
                  <div className="col-span-3">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Host</label>
                    <input type="text" required value={connForm.host} onChange={e => setConnForm({...connForm, host: e.target.value})} className="input-field" placeholder="192.168.1.100" />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Port</label>
                    <input type="number" required value={connForm.port} onChange={e => setConnForm({...connForm, port: parseInt(e.target.value) || 22})} className="input-field" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">User</label>
                  <input type="text" required value={connForm.user} onChange={e => setConnForm({...connForm, user: e.target.value})} className="input-field" placeholder="root" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Пароль (або ключ через ssh-agent)' : 'Password (or use ssh-agent key)'}</label>
                  <input type="password" value={connForm.password} onChange={e => setConnForm({...connForm, password: e.target.value})} className="input-field" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Приватний ключ (вставте вміст)' : 'Private Key (paste content)'}</label>
                  <textarea rows={6} value={connForm.key} onChange={e => setConnForm({...connForm, key: e.target.value})} className="input-field font-mono text-xs resize-none" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
                </div>
              </div>
              
              <div className="flex justify-end gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setConnDialogOpen(false)} className="btn-secondary px-4 py-2">
                  {t('cancel')}
                </button>
                <button type="submit" className="btn-primary px-6 py-2">
                  {isUk ? 'Додати' : 'Add'}
                </button>
              </div>
            </form>
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
