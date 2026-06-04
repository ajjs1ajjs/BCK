import { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Trash2, Edit2, Play, RefreshCw, Link as LinkIcon, Database,
  AlertCircle, CheckCircle2, PlayCircle, X 
} from 'lucide-react';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

const DB_TYPES = ['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'];

export default function DatabaseBackups() {
  const [tab, setTab] = useState(0);
  const [connections, setConnections] = useState([]);
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connDialog, setConnDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingConn, setEditingConn] = useState(null);
  
  const [form, setForm] = useState({ 
    name: '', source: '', destination: '', type: 'mysql', 
    config: { connectionId: '', database: '', encryption: false, encryptionPassword: '' } 
  });
  
  const [connForm, setConnForm] = useState({ 
    name: '', type: 'mysql', host: '', port: 3306, user: '', password: '', database: '' 
  });
  
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const [cloudCreds, setCloudCreds] = useState([]);
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/db-connections`)
      .then(r => r.json())
      .then(data => setConnections(Array.isArray(data) ? data : []))
      .catch(e => console.error('Load error:', e));
      
    fetch(`${API}/api/backups?limit=500&type=db`)
      .then(r => r.json())
      .then(data => {
        const b = data?.data || (Array.isArray(data) ? data : []);
        setBackups(b.filter(x => DB_TYPES.includes(x.backupType || x.type)));
      })
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

  // Connection Dialog
  const openConnCreate = () => { 
    setEditingConn(null); 
    setConnForm({ name: '', type: 'mysql', host: '', port: 3306, user: '', password: '', database: '' }); 
    setConnDialog(true); 
  };
  
  const openConnEdit = (c) => { 
    setEditingConn(c); 
    setConnForm({ name: c.name, type: c.type, host: c.host, port: c.port, user: c.user, password: '', database: c.database }); 
    setConnDialog(true); 
  };

  const saveConn = async (e) => {
    e.preventDefault();
    if (!connForm.name || !connForm.host || !connForm.user) {
      showSnack('Name, host, and user required', 'warning'); return;
    }
    const method = editingConn ? 'PUT' : 'POST';
    const url = editingConn ? `${API}/api/db-connections/${editingConn.id}` : `${API}/api/db-connections`;
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(connForm) });
      if (!r.ok) throw new Error();
      showSnack(editingConn ? 'Connection updated' : 'Connection created', 'success');
      setConnDialog(false); 
      load();
    } catch { showSnack('Failed to save', 'error'); }
  };

  const deleteConn = async (id) => {
    if(!window.confirm("Are you sure?")) return;
    try { await fetch(`${API}/api/db-connections/${id}`, { method: 'DELETE' }); load(); }
    catch { showSnack('Failed to delete', 'error'); }
  };

  const testConn = async (id) => {
    try {
      const r = await fetch(`${API}/api/db-connections/${id}/test`, { method: 'POST' });
      const data = await r.json();
      showSnack(data.success ? `${t('connectionSuccess')}! ${data.databases?.length || 0} ${t('databasesFound').toLowerCase()}` : `${t('connectionFailed')}: ${data.error}`, data.success ? 'success' : 'error');
    } catch { showSnack(t('connectionFailed'), 'error'); }
  };

  // Backup Dialog
  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', source: '', destination: '', type: 'mysql', config: { connectionId: '', database: '', encryption: false, encryptionPassword: '' } });
    setDialogOpen(true);
  };

  const openEdit = (b) => {
    setEditing(b);
    setForm({
      name: b.name || '',
      source: b.source || '',
      destination: b.destination || '',
      type: b.backupType || b.type || 'mysql',
      config: {
        connectionId: b.config?.connectionId || '',
        database: b.config?.database || '',
        cloudCredentialId: b.config?.cloudCredentialId || '',
        encryption: b.config?.encryption || false,
        encryptionPassword: b.config?.encryptionPassword || '',
      },
    });
    setDialogOpen(true);
  };

  const saveBackup = async (e) => {
    e.preventDefault();
    if (!form.name || !form.destination) {
      showSnack('Name and destination required', 'warning'); return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;
    try {
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, backupType: form.type, type: 'full', source: form.config.connectionId || form.source }),
      });
      if (!r.ok) throw new Error();
      showSnack(editing ? 'Backup updated' : 'Backup created', 'success');
      setDialogOpen(false); 
      load();
    } catch { showSnack('Failed to save', 'error'); }
  };

  const runBackup = async (id) => {
    try {
      const r = await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
      const data = await r.json();
      showSnack(data.message, 'info');
      setTimeout(load, 2000);
    } catch { showSnack('Failed to start backup', 'error'); }
  };

  const deleteBackup = async (id) => {
    if(!window.confirm("Are you sure?")) return;
    try { await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' }); load(); }
    catch { showSnack('Failed to delete', 'error'); }
  };

  const runAllBackups = async () => {
    const dbBackups = backups.filter(b => b.status !== 'running');
    for (const b of dbBackups) {
      await fetch(`${API}/api/backups/${b.id}/run`, { method: 'POST' });
    }
    showSnack(`Started ${dbBackups.length} backup(s)`, 'info');
    setTimeout(load, 3000);
  };

  const getConnName = (id) => connections.find(c => c.id === id)?.name || id?.slice(0, 8) || 'N/A';

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
            {t('databases') || 'Database Backups'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            MySQL • PostgreSQL • Oracle • MongoDB • MSSQL • Redis
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={openConnCreate} className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
            <LinkIcon size={18} />
            {t('addConnection') || 'Connection'}
          </button>
          <button onClick={openCreate} className="btn-primary py-2.5 px-4 flex-1 sm:flex-none">
            <Plus size={18} />
            {t('newBackupBtn') || 'New Backup'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-4 border-b border-slate-200 dark:border-slate-800">
        <button 
          onClick={() => setTab(0)}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors ${tab === 0 ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          {t('backups') || 'Backups'} ({backups.length})
        </button>
        <button 
          onClick={() => setTab(1)}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors ${tab === 1 ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          {t('dbConnections') || 'Connections'} ({connections.length})
        </button>
      </div>

      <div className="glass-card">
        {tab === 0 && (
          <>
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap gap-2 items-center bg-slate-50/50 dark:bg-slate-900/50">
              <button onClick={load} className="btn-secondary px-3 py-1.5 text-sm" title={t('refresh')}>
                <RefreshCw size={16} /> {t('refresh') || 'Refresh'}
              </button>
              {backups.filter(b => b.status !== 'running').length > 0 && (
                <button onClick={runAllBackups} className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
                  <Play size={16} /> {t('runNow') || 'Run All'}
                </button>
              )}
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                    <th className="p-4 font-semibold">{t('name')}</th>
                    <th className="p-4 font-semibold">{t('type')}</th>
                    <th className="p-4 font-semibold">{t('dbConnections')}</th>
                    <th className="p-4 font-semibold">{t('destPath')}</th>
                    <th className="p-4 font-semibold">{t('status')}</th>
                    <th className="p-4 font-semibold">{t('createdAt')}</th>
                    <th className="p-4 font-semibold text-right">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="p-8 text-center text-slate-500">
                        <p className="text-sm font-medium">{t('noBackupsConfigured')}</p>
                      </td>
                    </tr>
                  ) : (
                    backups.map(b => (
                      <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                        <td className="p-4">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{b.name}</p>
                        </td>
                        <td className="p-4">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-blue-500/10 text-blue-600 border-blue-500/20 uppercase tracking-wider">
                            {b.backupType || b.type}
                          </span>
                        </td>
                        <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                          {getConnName(b.config?.connectionId)}
                        </td>
                        <td className="p-4">
                          <p className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded inline-block max-w-[150px] truncate">
                            {b.destination}
                          </p>
                        </td>
                        <td className="p-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider whitespace-nowrap ${getStatusStyle(b.status)}`}>
                            {b.status || 'unknown'}
                          </span>
                        </td>
                        <td className="p-4">
                          <p className="text-xs font-medium text-slate-500">
                            {(b.createdAt || '').slice(0, 10)}
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
          </>
        )}

        {tab === 1 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                  <th className="p-4 font-semibold">{t('name')}</th>
                  <th className="p-4 font-semibold">{t('type')}</th>
                  <th className="p-4 font-semibold">{t('host')}</th>
                  <th className="p-4 font-semibold">{t('databases')}</th>
                  <th className="p-4 font-semibold">{t('username')}</th>
                  <th className="p-4 font-semibold text-right">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {connections.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-slate-500">
                      <Database size={48} className="mx-auto mb-4 opacity-20" />
                      <p className="text-sm font-medium">{t('noBackupsConfigured')}</p>
                    </td>
                  </tr>
                ) : (
                  connections.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="p-4">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{c.name}</p>
                      </td>
                      <td className="p-4">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-500/10 text-purple-600 border-purple-500/20 uppercase tracking-wider">
                          {c.type}
                        </span>
                      </td>
                      <td className="p-4">
                        <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {c.host}:{c.port}
                        </p>
                      </td>
                      <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                        {c.database || '—'}
                      </td>
                      <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                        {c.user}
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => testConn(c.id)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('testConnection')}>
                            <LinkIcon size={18} />
                          </button>
                          <button onClick={() => openConnEdit(c)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title={t('edit')}>
                            <Edit2 size={18} />
                          </button>
                          <button onClick={() => deleteConn(c.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete')}>
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
        )}
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
                  <input type="text" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" placeholder="e.g. MySQL Dump" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('type')}</label>
                  <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input-field">
                    {DB_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('dbConnections')}</label>
                  <select required value={form.config.connectionId} onChange={e => setForm({...form, config: {...form.config, connectionId: e.target.value}})} className="input-field">
                    <option value="" disabled>Select a connection</option>
                    {connections.filter(c => c.type === form.type).map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.host}:{c.port})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('databases')}</label>
                  <input type="text" value={form.config.database} onChange={e => setForm({...form, config: {...form.config, database: e.target.value}})} className="input-field" placeholder="e.g. my_db" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('destPath')}</label>
                  <input type="text" required value={form.destination} onChange={e => setForm({...form, destination: e.target.value})} className="input-field" placeholder="/backup/db" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('sourcePath')} (Optional)</label>
                  <input type="text" value={form.source} onChange={e => setForm({...form, source: e.target.value})} className="input-field" placeholder="Custom source path" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Upload to Cloud (optional)</label>
                  <select value={form.config.cloudCredentialId || ''} onChange={e => setForm({...form, config: {...form.config, cloudCredentialId: e.target.value}})} className="input-field">
                    <option value="">None — local only</option>
                    {cloudCreds.map(c => <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>)}
                  </select>
                </div>

                <div className="flex items-center gap-2 mt-4">
                  <input 
                    type="checkbox" 
                    id="encryption" 
                    checked={form.config.encryption || false} 
                    onChange={e => setForm({...form, config: {...form.config, encryption: e.target.checked}})} 
                    className="custom-checkbox"
                  />
                  <label htmlFor="encryption" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                    Encrypt Backup File (AES-256)
                  </label>
                </div>

                {form.config.encryption && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Encryption Password</label>
                    <input type="password" required value={form.config.encryptionPassword || ''} onChange={e => setForm({...form, config: {...form.config, encryptionPassword: e.target.value}})} className="input-field" placeholder="Enter password to encrypt" />
                  </div>
                )}
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
      {connDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingConn ? t('editConnection') : t('addConnection')}
              </h2>
              <button onClick={() => setConnDialog(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={saveConn}>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('name')}</label>
                  <input type="text" required value={connForm.name} onChange={e => setConnForm({...connForm, name: e.target.value})} className="input-field" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('type')}</label>
                  <select 
                    value={connForm.type} 
                    onChange={e => {
                      const type = e.target.value;
                      let port = 3306;
                      if (type === 'postgres') port = 5432;
                      if (type === 'oracle') port = 1521;
                      if (type === 'mongodb') port = 27017;
                      if (type === 'mssql') port = 1433;
                      if (type === 'redis') port = 6379;
                      setConnForm({...connForm, type, port });
                    }} 
                    className="input-field"
                  >
                    {DB_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('host')}</label>
                    <input type="text" required value={connForm.host} onChange={e => setConnForm({...connForm, host: e.target.value})} className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('port')}</label>
                    <input type="number" required value={connForm.port} onChange={e => setConnForm({...connForm, port: parseInt(e.target.value)})} className="input-field" />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('databases')}</label>
                  <input type="text" value={connForm.database} onChange={e => setConnForm({...connForm, database: e.target.value})} className="input-field" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('username')}</label>
                  <input type="text" required value={connForm.user} onChange={e => setConnForm({...connForm, user: e.target.value})} className="input-field" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('password')}</label>
                  <input type="password" value={connForm.password} onChange={e => setConnForm({...connForm, password: e.target.value})} className="input-field" placeholder={editingConn ? 'Leave blank to keep current' : ''} />
                </div>
              </div>
              
              <div className="flex justify-end gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setConnDialog(false)} className="btn-secondary px-4 py-2">
                  {t('cancel')}
                </button>
                <button type="submit" className="btn-primary px-6 py-2">
                  {editingConn ? t('save') : t('create')}
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
