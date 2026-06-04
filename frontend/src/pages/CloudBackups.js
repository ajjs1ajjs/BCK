import { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Trash2, Edit2, RefreshCw, Link as LinkIcon, Cloud, CloudUpload,
  AlertCircle, CheckCircle2, PlayCircle, X 
} from 'lucide-react';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

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
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { t } = useTranslation();

  const [credForm, setCredForm] = useState({
    name: '', provider: 'aws',
    credentials: { accessKeyId: '', secretAccessKey: '', region: 'us-east-1', bucket: '' },
  });

  const [backupForm, setBackupForm] = useState({
    name: '', destination: '', type: 'full', backupType: 'cloud',
    config: { cloudCredentialId: '', remotePath: '', bucket: '', compression: 'none', encryptionKey: '' },
  });

  const load = useCallback(() => {
    fetch(`${API}/api/cloud-credentials`)
      .then(r => r.json())
      .then(data => setCreds(Array.isArray(data) ? data : []))
      .catch(e => console.error('Load error:', e));
    fetch(`${API}/api/backups?limit=500&type=cloud`)
      .then(r => r.json())
      .then(data => {
        const b = data?.data || (Array.isArray(data) ? data : []);
        setBackups(b.filter(x => x.backupType === 'cloud').map(x => ({ ...x, type: 'cloud' })));
      })
      .catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

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

  const saveCred = async (e) => {
    e.preventDefault();
    if (!credForm.name || !credForm.provider) {
      showSnack('Name and provider required', 'warning'); return;
    }
    const method = editingCred ? 'PUT' : 'POST';
    const url = editingCred ? `${API}/api/cloud-credentials/${editingCred.id}` : `${API}/api/cloud-credentials`;
    try {
      const body = { name: credForm.name, provider: credForm.provider, credentials: credForm.credentials };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      showSnack(editingCred ? 'Credentials updated' : 'Credentials created', 'success');
      setCredDialog(false); 
      load();
    } catch { showSnack('Failed to save', 'error'); }
  };

  const deleteCred = async (id) => {
    if(!window.confirm("Are you sure?")) return;
    try { await fetch(`${API}/api/cloud-credentials/${id}`, { method: 'DELETE' }); load(); }
    catch { showSnack('Failed to delete', 'error'); }
  };

  const testCred = async (id) => {
    try {
      const r = await fetch(`${API}/api/cloud-credentials/${id}/test`, { method: 'POST' });
      const data = await r.json();
      showSnack(data.success ? data.message : `Failed: ${data.error}`, data.success ? 'success' : 'error');
    } catch { showSnack('Test failed', 'error'); }
  };

  const openCreate = () => {
    setEditing(null);
    setBackupForm({
      name: '', destination: '', type: 'full', backupType: 'cloud',
      config: { cloudCredentialId: '', remotePath: '', bucket: '', compression: 'none', encryptionKey: '' },
    });
    setDialogOpen(true);
  };

  const openEdit = (b) => {
    setEditing(b);
    setBackupForm({
      name: b.name,
      destination: b.destination,
      type: b.backupType || b.type || 'full',
      backupType: 'cloud',
      config: {
        cloudCredentialId: b.config?.cloudCredentialId || '',
        remotePath: b.config?.remotePath || '',
        bucket: b.config?.bucket || '',
        compression: b.config?.compression || 'none',
        encryptionKey: b.config?.encryptionKey || '',
      },
    });
    setDialogOpen(true);
  };

  const saveBackup = async (e) => {
    e.preventDefault();
    if (!backupForm.name || !backupForm.config.cloudCredentialId) {
      showSnack('Name and cloud credentials required', 'warning'); return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;
    try {
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupForm),
      });
      if (!r.ok) throw new Error();
      showSnack(editing ? 'Updated' : 'Created', 'success');
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
    } catch {
      showSnack('Failed to start backup', 'error');
    }
  };

  const deleteBackup = async (id) => {
    if(!window.confirm("Are you sure?")) return;
    try { await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' }); load(); }
    catch { showSnack('Failed to delete', 'error'); }
  };

  const getProviderLabel = (p) => PROVIDERS.find(x => x.value === p)?.label || p;

  const renderCredFields = () => {
    const { provider, credentials } = credForm;
    const update = (k, v) => setCredForm({ ...credForm, credentials: { ...credentials, [k]: v } });

    switch (provider) {
      case 'aws':
        return (
          <>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('accessKeyId')}</label>
              <input type="text" required value={credentials.accessKeyId || ''} onChange={e => update('accessKeyId', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('secretAccessKey')}</label>
              <input type="password" value={credentials.secretAccessKey || ''} onChange={e => update('secretAccessKey', e.target.value)} className="input-field" placeholder={editingCred ? 'Leave blank to keep' : ''} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('region')}</label>
              <input type="text" value={credentials.region || 'us-east-1'} onChange={e => update('region', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('bucket')}</label>
              <input type="text" value={credentials.bucket || ''} onChange={e => update('bucket', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('endpoint')}</label>
              <input type="text" value={credentials.endpoint || ''} onChange={e => update('endpoint', e.target.value)} className="input-field" placeholder="https://s3.custom.com" />
            </div>
          </>
        );
      case 'azure':
        return (
          <>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('storageAccount')}</label>
              <input type="text" required value={credentials.storageAccount || ''} onChange={e => update('storageAccount', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Access Key</label>
              <input type="password" value={credentials.accessKey || ''} onChange={e => update('accessKey', e.target.value)} className="input-field" placeholder={editingCred ? 'Leave blank to keep' : ''} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('container')}</label>
              <input type="text" value={credentials.container || ''} onChange={e => update('container', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('endpoint')}</label>
              <input type="text" value={credentials.endpoint || ''} onChange={e => update('endpoint', e.target.value)} className="input-field" />
            </div>
          </>
        );
      case 'gcp':
        return (
          <>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Project ID</label>
              <input type="text" required value={credentials.projectId || ''} onChange={e => update('projectId', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">GCS Bucket</label>
              <input type="text" value={credentials.bucket || ''} onChange={e => update('bucket', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Service Account JSON</label>
              <textarea rows={4} value={credentials.credentials || ''} onChange={e => update('credentials', e.target.value)} className="input-field resize-none" placeholder="Paste your service account key JSON" />
            </div>
          </>
        );
      default: return null;
    }
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
            {t('cloud') || 'Cloud Storage'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            Amazon S3 • Azure Blob • Google Cloud Storage
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={() => openCredCreate('aws')} className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
            <Cloud size={18} />
            {t('addCredentials') || 'Credentials'}
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
          {t('cloudCredentials') || 'Credentials'} ({creds.length})
        </button>
      </div>

      <div className="glass-card">
        {tab === 0 && (
          <>
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
              <button onClick={load} className="btn-secondary px-3 py-1.5 text-sm" title={t('refresh')}>
                <RefreshCw size={16} /> {t('refresh') || 'Refresh'}
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                    <th className="p-4 font-semibold">{t('name')}</th>
                    <th className="p-4 font-semibold">{t('cloud')}</th>
                    <th className="p-4 font-semibold">{t('sourcePath')}</th>
                    <th className="p-4 font-semibold">{t('status')}</th>
                    <th className="p-4 font-semibold">{t('createdAt')}</th>
                    <th className="p-4 font-semibold text-right">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="p-8 text-center text-slate-500">
                        <CloudUpload size={48} className="mx-auto mb-4 opacity-20" />
                        <p className="text-sm font-medium">{t('noBackupsConfigured')}</p>
                      </td>
                    </tr>
                  ) : (
                    backups.map(b => (
                      <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                        <td className="p-4">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{b.name}</p>
                        </td>
                        <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                          {getProviderLabel(creds.find(c => c.id === b.config?.cloudCredentialId)?.provider)}
                        </td>
                        <td className="p-4">
                          <p className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded inline-block max-w-[200px] truncate">
                            {b.config?.remotePath || '—'}
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
                  <th className="p-4 font-semibold">{t('provider')}</th>
                  <th className="p-4 font-semibold">{t('bucket')}</th>
                  <th className="p-4 font-semibold">{t('region')}</th>
                  <th className="p-4 font-semibold text-right">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {creds.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-slate-500">
                      <Cloud size={48} className="mx-auto mb-4 opacity-20" />
                      <p className="text-sm font-medium mb-4">{t('noBackupsConfigured')}</p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {PROVIDERS.map(p => (
                          <button key={p.value} onClick={() => openCredCreate(p.value)} className="btn-secondary px-3 py-1.5 text-sm">
                            <Cloud size={16} /> {p.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : (
                  creds.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="p-4">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{c.name}</p>
                      </td>
                      <td className="p-4">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 uppercase tracking-wider">
                          {getProviderLabel(c.provider)}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                        {c.credentials?.bucket || c.credentials?.container || '—'}
                      </td>
                      <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                        {c.credentials?.region || '—'}
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => testCred(c.id)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('testConnection')}>
                            <LinkIcon size={18} />
                          </button>
                          <button onClick={() => openCredEdit(c)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title={t('edit')}>
                            <Edit2 size={18} />
                          </button>
                          <button onClick={() => deleteCred(c.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete')}>
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

      {/* Cloud Credentials Dialog */}
      {credDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingCred ? t('editCredentials') : t('addCredentials')}
              </h2>
              <button onClick={() => setCredDialog(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={saveCred}>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('name')}</label>
                  <input type="text" required value={credForm.name} onChange={e => setCredForm({...credForm, name: e.target.value})} className="input-field" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('provider')}</label>
                  <select value={credForm.provider} onChange={e => resetCredForm(e.target.value)} className="input-field">
                    {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>

                {renderCredFields()}
              </div>
              
              <div className="flex justify-end gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setCredDialog(false)} className="btn-secondary px-4 py-2">
                  {t('cancel')}
                </button>
                <button type="submit" className="btn-primary px-6 py-2">
                  {editingCred ? t('save') : t('create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                  <input type="text" required value={backupForm.name} onChange={e => setBackupForm({...backupForm, name: e.target.value})} className="input-field" placeholder="e.g. S3 Weekly Backup" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('cloudCredentials')}</label>
                  <select required value={backupForm.config?.cloudCredentialId || ''} onChange={e => setBackupForm({...backupForm, config: {...backupForm.config, cloudCredentialId: e.target.value}})} className="input-field">
                    <option value="" disabled>Select credentials</option>
                    {creds.map(c => <option key={c.id} value={c.id}>{c.name} ({getProviderLabel(c.provider)})</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('bucket')}</label>
                  <input type="text" value={backupForm.config?.bucket || ''} onChange={e => setBackupForm({...backupForm, config: {...backupForm.config, bucket: e.target.value}})} className="input-field" placeholder="my-bucket" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('destPath')}</label>
                  <input type="text" required value={backupForm.config?.remotePath || ''} onChange={e => setBackupForm({...backupForm, config: {...backupForm.config, remotePath: e.target.value}})} className="input-field" placeholder="backups/my-server/" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('sourcePath')} (Local)</label>
                  <input type="text" required value={backupForm.destination || ''} onChange={e => setBackupForm({...backupForm, destination: e.target.value})} className="input-field" placeholder="/data/to/backup" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Compression</label>
                  <select value={backupForm.config?.compression || 'none'} onChange={e => setBackupForm({...backupForm, config: {...backupForm.config, compression: e.target.value}})} className="input-field">
                    <option value="none">None</option>
                    <option value="gzip">GZip (.gz)</option>
                    <option value="zip">ZIP (.zip)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Encryption Key (optional)</label>
                  <input type="password" value={backupForm.config?.encryptionKey || ''} onChange={e => setBackupForm({...backupForm, config: {...backupForm.config, encryptionKey: e.target.value}})} className="input-field" placeholder="AES-256 encryption passphrase" />
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
