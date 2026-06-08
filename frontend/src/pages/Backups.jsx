import { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Trash2, Edit2, Play, Search, RefreshCw, 
  Database, AlertCircle, CheckCircle2, PlayCircle, X 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

const EMPTY = { name: '', source: '', destination: '', type: 'full' };

export default function Backups() {
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [selected, setSelected] = useState([]);
  const { can, token } = useAuth();
  const { t } = useTranslation();
  const headers = { Authorization: `Bearer ${token}` };

  const filtered = backups.filter(b =>
    b.name?.toLowerCase().includes(search.toLowerCase()) ||
    b.source?.toLowerCase().includes(search.toLowerCase())
  );

  const load = useCallback(() => {
    fetch(`${API}/api/backups?limit=500`, { headers })
      .then(r => r.json())
      .then(data => setBackups(data?.data || (Array.isArray(data) ? data : [])))
      .catch(e => console.error('Load error:', e));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const openCreate = () => { setEditing(null); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (b) => { 
    setEditing(b); 
    setForm({ name: b.name, source: b.source, destination: b.destination, type: b.type || 'full' }); 
    setDialogOpen(true); 
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name || !form.source || !form.destination) {
      showSnack('Name, source, and destination are required', 'warning');
      return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;
    try {
      const r = await fetch(url, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error('Request failed');
      showSnack(editing ? 'Backup updated' : 'Backup created', 'success');
      setDialogOpen(false);
      load();
    } catch {
      showSnack('Failed to save backup', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE', headers });
      showSnack('Backup deleted', 'success');
      setDeleteConfirm(null);
      load();
    } catch {
      showSnack('Failed to delete', 'error');
    }
  };

  const handleRun = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}/run`, { method: 'POST', headers });
      showSnack('Backup job started', 'info');
      setTimeout(load, 2000);
    } catch {
      showSnack('Failed to start backup', 'error');
    }
  };

  const isAllSelected = selected.length === filtered.length && filtered.length > 0;
  const toggleSelectAll = () => {
    if (isAllSelected) { setSelected([]); }
    else { setSelected(filtered.map(b => b.id)); }
  };
  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const bulkRun = async () => {
    for (const id of selected) {
      await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
    }
    showSnack(`Started ${selected.length} backup(s)`, 'info');
    setSelected([]);
    setTimeout(load, 3000);
  };

  const bulkDelete = async () => {
    for (const id of selected) {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' });
    }
    showSnack(`Deleted ${selected.length} backup(s)`, 'success');
    setSelected([]);
    setBulkConfirm(null);
    load();
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
            {t('backups') || 'Files & Folders Backups'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {t('allBackups')} — {backups.length} {t('totalJobs').toLowerCase()}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary py-2.5 px-4 w-full sm:w-auto">
          <Plus size={18} />
          {t('newBackupBtn') || 'New Backup'}
        </button>
      </div>

      <div className="glass-card">
        
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-4 justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder={`${t('search')}...`}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <button onClick={load} className="btn-secondary p-2.5 rounded-lg flex-shrink-0" title={t('refresh')}>
              <RefreshCw size={18} />
            </button>
          </div>

          {selected.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg w-full sm:w-auto animate-fade-in">
              <span className="text-sm font-bold text-purple-700 dark:text-purple-400 mr-2">
                {selected.length} selected
              </span>
              <button onClick={bulkRun} className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-md transition-colors">
                <Play size={14} /> {t('runNow')}
              </button>
              {can('delete') && (
                <button onClick={() => setBulkConfirm(true)} className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-md transition-colors">
                  <Trash2 size={14} /> {t('delete')}
                </button>
              )}
              <button onClick={() => setSelected([])} className="p-1 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded transition-colors">
                <X size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                {can('delete') && (
                  <th className="p-4 w-12 font-semibold text-center">
                    <input type="checkbox" className="custom-checkbox" checked={isAllSelected} onChange={toggleSelectAll} />
                  </th>
                )}
                <th className="p-4 font-semibold">{t('name')}</th>
                <th className="p-4 font-semibold">{t('sourcePath')}</th>
                <th className="p-4 font-semibold">{t('destPath')}</th>
                <th className="p-4 font-semibold">{t('type')}</th>
                <th className="p-4 font-semibold">{t('status')}</th>
                <th className="p-4 font-semibold">{t('createdAt')}</th>
                <th className="p-4 font-semibold text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={can('delete') ? 8 : 7} className="p-8 text-center text-slate-500">
                    <Database size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium">{search ? t('noDataYet') : t('noBackupsConfigured')}</p>
                  </td>
                </tr>
              ) : (
                filtered.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                    {can('delete') && (
                      <td className="p-4 text-center">
                        <input type="checkbox" className="custom-checkbox" checked={selected.includes(b.id)} onChange={() => toggleSelect(b.id)} />
                      </td>
                    )}
                    <td className="p-4">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{b.name}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded inline-block max-w-[200px] truncate">
                        {b.source}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded inline-block max-w-[200px] truncate">
                        {b.destination}
                      </p>
                    </td>
                    <td className="p-4">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 uppercase tracking-wider">
                        {b.backupType || b.type}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider whitespace-nowrap ${getStatusStyle(b.status)}`}>
                        {b.status || 'unknown'}
                      </span>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-medium text-slate-500">
                        {(b.createdAt || '').slice(0, 16).replace('T', ' ')}
                      </p>
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleRun(b.id)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('runNow')}>
                          <PlayCircle size={18} />
                        </button>
                        {can('manageBackups') && (
                          <>
                            <button onClick={() => openEdit(b)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title={t('edit')}>
                              <Edit2 size={18} />
                            </button>
                            <button onClick={() => setDeleteConfirm(b)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete')}>
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal - Edit/Create */}
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
            
            <form onSubmit={handleSave}>
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('name')}</label>
                  <input type="text" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" placeholder="E.g. MySQL Data" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('sourcePath')}</label>
                  <input type="text" required value={form.source} onChange={e => setForm({...form, source: e.target.value})} className="input-field" placeholder="/var/lib/mysql" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('destPath')}</label>
                  <input type="text" required value={form.destination} onChange={e => setForm({...form, destination: e.target.value})} className="input-field" placeholder="/backup/db" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('type')}</label>
                  <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input-field">
                    <option value="full">Full</option>
                    <option value="incremental">Incremental</option>
                    <option value="differential">Differential</option>
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

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/20 text-red-500 flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                {t('deleteConfirmTitle')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('deleteConfirmDesc')} <br/>
                <span className="font-semibold text-slate-700 dark:text-slate-300 mt-2 block">"{deleteConfirm.name}"</span>
              </p>
            </div>
            <div className="flex justify-end gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">
                {t('cancel')}
              </button>
              <button onClick={() => handleDelete(deleteConfirm.id)} className="btn-primary flex-1 bg-red-500 hover:bg-red-600 shadow-red-500/25">
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation */}
      {bulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/20 text-red-500 flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                {t('deleteConfirmTitle')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('deleteConfirmDesc')} <br/>
                <span className="font-semibold text-slate-700 dark:text-slate-300 mt-2 block">({selected.length} items)</span>
              </p>
            </div>
            <div className="flex justify-end gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => setBulkConfirm(null)} className="btn-secondary flex-1">
                {t('cancel')}
              </button>
              <button onClick={bulkDelete} className="btn-primary flex-1 bg-red-500 hover:bg-red-600 shadow-red-500/25">
                {t('delete')} {selected.length}
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
