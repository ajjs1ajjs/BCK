import { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Trash2, Edit2, RefreshCw, HardDrive, AlertCircle, 
  CheckCircle2, PlayCircle, X 
} from 'lucide-react';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

const EMPTY_FORM = {
  name: '',
  sourcePath: '/',
  destination: '/backup/hosts',
  excludes: '/dev\n/proc\n/sys\n/run\n/tmp\n/mnt\n/media',
};

export default function HostBackups() {
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { t, lang } = useTranslation();
  const isUk = lang === 'uk';

  const load = useCallback(() => {
    fetch(`${API}/api/backups?type=host`)
      .then(r => r.json())
      .then(data => setBackups(data?.data || (Array.isArray(data) ? data : [])))
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
      sourcePath: backup.config?.sourcePath || backup.source || '/',
      destination: backup.destination || '/backup/hosts',
      excludes: (backup.config?.excludes || []).join('\n'),
    });
    setDialogOpen(true);
  };

  const saveBackup = async (e) => {
    e.preventDefault();
    if (!form.name || !form.sourcePath || !form.destination) {
      showSnack(isUk ? 'Назва, шлях хоста і сховище обовʼязкові' : 'Name, host path, and destination are required', 'warning');
      return;
    }

    const excludes = form.excludes.split('\n').map(item => item.trim()).filter(Boolean);
    const payload = {
      name: form.name,
      source: form.sourcePath,
      destination: form.destination,
      type: 'full',
      backupType: 'host',
      config: { sourcePath: form.sourcePath, excludes },
    };

    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/backups/${editing.id}` : `${API}/api/backups`;

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error();
      showSnack(editing ? (isUk ? 'Копіювання хоста оновлено' : 'Host backup updated') : (isUk ? 'Копіювання хоста створено' : 'Host backup created'), 'success');
      setDialogOpen(false);
      load();
    } catch {
      showSnack(isUk ? 'Не вдалося зберегти backup хоста' : 'Failed to save host backup', 'error');
    }
  };

  const runBackup = async (id) => {
    try {
      await fetch(`${API}/api/backups/${id}/run`, { method: 'POST' });
      showSnack(isUk ? 'Копіювання хоста запущено' : 'Host backup started', 'info');
      setTimeout(load, 2000);
    } catch {
      showSnack(isUk ? 'Не вдалося запустити копіювання' : 'Failed to start backup', 'error');
    }
  };

  const deleteBackup = async (id) => {
    if(!window.confirm(isUk ? 'Видалити?' : 'Delete?')) return;
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE' });
      showSnack('Deleted', 'success');
      load();
    } catch {
      showSnack(isUk ? 'Не вдалося видалити' : 'Failed to delete', 'error');
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
            {isUk ? 'Хости' : 'Hosts'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {isUk ? 'Повне файлове копіювання хоста через tar-архів' : 'Full host file backup using tar archives'}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary py-2.5 px-4 w-full sm:w-auto">
          <Plus size={18} />
          {isUk ? 'Нове копіювання хоста' : 'New Host Backup'}
        </button>
      </div>

      <div className="glass-card">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
          <button onClick={load} className="btn-secondary px-3 py-1.5 text-sm" title={t('refresh')}>
            <RefreshCw size={16} /> {t('refresh') || 'Refresh'}
          </button>
        </div>
        
        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="p-4 font-semibold">{t('name')}</th>
                <th className="p-4 font-semibold">{isUk ? 'Шлях хоста' : 'Host path'}</th>
                <th className="p-4 font-semibold">{t('destPath')}</th>
                <th className="p-4 font-semibold">{t('status')}</th>
                <th className="p-4 font-semibold">{t('createdAt')}</th>
                <th className="p-4 font-semibold text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {backups.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-500">
                    <HardDrive size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium">{isUk ? 'Копіювання хостів ще не налаштоване' : 'No host backups configured'}</p>
                  </td>
                </tr>
              ) : (
                backups.map(backup => (
                  <tr key={backup.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td className="p-4">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{backup.name}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded inline-block">
                        {backup.config?.sourcePath || backup.source}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded inline-block">
                        {backup.destination}
                      </p>
                    </td>
                    <td className="p-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider whitespace-nowrap ${getStatusStyle(backup.status)}`}>
                        {backup.status || 'unknown'}
                      </span>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-medium text-slate-500">
                        {(backup.createdAt || '').slice(0, 10)}
                      </p>
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => runBackup(backup.id)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('runNow')}>
                          <PlayCircle size={18} />
                        </button>
                        <button onClick={() => openEdit(backup)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title={t('edit')}>
                          <Edit2 size={18} />
                        </button>
                        <button onClick={() => deleteBackup(backup.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete')}>
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

      {/* Backup Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {editing ? (isUk ? 'Редагувати копіювання хоста' : 'Edit Host Backup') : (isUk ? 'Додати копіювання хоста' : 'Add Host Backup')}
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
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Що копіювати на хості' : 'Host path to back up'}</label>
                  <input type="text" required value={form.sourcePath} onChange={e => setForm({...form, sourcePath: e.target.value})} className="input-field font-mono text-sm" placeholder="/" />
                  <p className="text-[11px] text-slate-500 mt-1">{isUk ? 'Для цілого хоста використовуйте /. Системні каталоги виключаються нижче.' : 'Use / for the whole host. System folders are excluded below.'}</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('destPath')}</label>
                  <input type="text" required value={form.destination} onChange={e => setForm({...form, destination: e.target.value})} className="input-field font-mono text-sm" placeholder="/backup/hosts" />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{isUk ? 'Виключити з копії' : 'Exclude from backup'}</label>
                  <textarea rows={5} value={form.excludes} onChange={e => setForm({...form, excludes: e.target.value})} className="input-field font-mono text-sm resize-none" />
                  <p className="text-[11px] text-slate-500 mt-1">{isUk ? 'Один шлях на рядок. Наприклад: /proc, /sys, /tmp.' : 'One path per line. Example: /proc, /sys, /tmp.'}</p>
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
