import { useState, useEffect, useCallback } from 'react';
import { 
  RefreshCw, Search, Filter, Trash2, Download,
  CheckCircle2, XCircle, Clock, AlertCircle, X,
  History, Activity
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

export default function JobHistory() {
  const [backups, setBackups] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { can, token } = useAuth();
  const { t } = useTranslation();
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(() => {
    fetch(`${API}/api/backups`, { headers })
      .then(r => r.json())
      .then(data => setBackups(data?.data || (Array.isArray(data) ? data : [])))
      .catch(e => console.error('Load error:', e));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const filtered = backups.filter(b => {
    if (filter === 'completed' && b.status !== 'completed') return false;
    if (filter === 'failed' && b.status !== 'failed') return false;
    if (filter === 'running' && b.status !== 'running') return false;
    if (search && !b.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const deleteBackup = async (id) => {
    if(!window.confirm(t('confirmDelete') || "Are you sure?")) return;
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE', headers });
      load();
      showSnack(t('deleted'), 'success');
    } catch {
      showSnack(t('deleteFailed'), 'error');
    }
  };

  const downloadBackupFile = async (b) => {
    try {
      const r = await fetch(`${API}/api/backups/${b.id}/download`, { headers });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || 'Download failed');
      }
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      let filename = b.resultFile ? b.resultFile.split(/[/\\]/).pop() : `backup_${b.id}.zip`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      showSnack(`Failed to download: ${e.message}`, 'error');
    }
  };

  const getDuration = (b) => {
    if (!b.startedAt || !b.completedAt) return '—';
    const ms = new Date(b.completedAt) - new Date(b.startedAt);
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  const getStatusConfig = (status) => {
    switch (status) {
      case 'completed': 
        return { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
      case 'failed': 
        return { icon: XCircle, color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/20' };
      case 'running': 
        return { icon: Activity, color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/20', animate: 'animate-pulse' };
      default: 
        return { icon: Clock, color: 'text-slate-600', bg: 'bg-slate-500/10', border: 'border-slate-500/20' };
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {t('history')}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {t('jobHistorySubtitle', { total: backups.length }).replace('{{total}}', backups.length)}
          </p>
        </div>
        <button onClick={load} className="btn-secondary py-2 px-4 w-full sm:w-auto">
          <RefreshCw size={16} />
          {t('refresh')}
        </button>
      </div>

      <div className="glass-card">
        {/* Filters */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-wrap gap-4 items-center">
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select 
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 pr-8 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-700 dark:text-slate-200 appearance-none min-w-[150px]"
            >
              <option value="all">{t('allStatuses')}</option>
              <option value="completed">{t('completed')}</option>
              <option value="running">{t('running')}</option>
              <option value="failed">{t('failed')}</option>
            </select>
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder={t('searchJobs')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-700 dark:text-slate-200"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="p-4 font-semibold">{t('jobName')}</th>
                <th className="p-4 font-semibold">{t('type')}</th>
                <th className="p-4 font-semibold">{t('status')}</th>
                <th className="p-4 font-semibold">{t('started')}</th>
                <th className="p-4 font-semibold">{t('duration')}</th>
                <th className="p-4 font-semibold">{t('size')}</th>
                <th className="p-4 font-semibold">{t('result')}</th>
                {(can('delete') || can('restore')) && (
                  <th className="p-4 font-semibold text-right">{t('actions')}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={can('delete') ? 8 : 7} className="p-12 text-center text-slate-500">
                    <History size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium">{t('noJobHistory')}</p>
                  </td>
                </tr>
              ) : (
                filtered.map(b => {
                  const sConf = getStatusConfig(b.status);
                  const StatusIcon = sConf.icon;
                  return (
                    <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="p-4">
                        <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight">{b.name}</p>
                      </td>
                      <td className="p-4">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 uppercase tracking-wider">
                          {b.backupType || b.type}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${sConf.bg} ${sConf.color} ${sConf.border}`}>
                          <StatusIcon size={14} className={sConf.animate || ''} />
                          <span className="capitalize">{t(b.status) || b.status}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="text-xs font-medium text-slate-500">
                          {(b.startedAt || b.createdAt || '').slice(0, 19).replace('T', ' ')}
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {getDuration(b)}
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {b.resultFile ? `${(b.size || 0) > 0 ? (b.size / 1024 / 1024).toFixed(1) + ' MB' : '—'}` : '—'}
                        </p>
                      </td>
                      <td className="p-4">
                        {b.error ? (
                          <div className="group/error relative inline-block">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-red-500/10 text-red-600 border-red-500/20 uppercase tracking-wider cursor-help">
                              {t('error') || 'Error'}
                            </span>
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[200px] bg-slate-900 text-white text-xs p-2 rounded shadow-xl opacity-0 invisible group-hover/error:opacity-100 group-hover/error:visible transition-all z-10 break-words">
                              {b.error}
                            </div>
                          </div>
                        ) : b.status === 'completed' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-emerald-500/10 text-emerald-600 border-emerald-500/20 uppercase tracking-wider">
                            OK
                          </span>
                        ) : '—'}
                      </td>
                      {(can('delete') || can('restore')) && (
                        <td className="p-4 text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {can('restore') && b.status === 'completed' && b.resultFile && (
                              <button onClick={() => downloadBackupFile(b)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('download')}>
                                <Download size={18} />
                              </button>
                            )}
                            {can('delete') && (
                              <button onClick={() => deleteBackup(b.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete')}>
                                <Trash2 size={18} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

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
