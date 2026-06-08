import { useState, useEffect, useCallback } from 'react';
import { 
  RefreshCw, Search, Filter, 
  AlertTriangle, CheckCircle2, Info, XCircle
} from 'lucide-react';
import { useTranslation } from '../context/LangContext';
import { useAuth } from '../context/AuthContext';
import { API } from '../utils/config';

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { t } = useTranslation();
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(() => {
    fetch(`${API}/api/logs`, { headers })
      .then(r => r.json())
      .then(data => setLogs(data?.data || (Array.isArray(data) ? data : [])))
      .catch(e => console.error('Load error:', e));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = logs.filter((log) => {
    if (filter !== 'all' && log.status !== filter) return false;
    if (search && !log.message?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const getStatusConfig = (status) => {
    switch (status) {
      case 'error': 
        return { icon: XCircle, color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/20' };
      case 'warning': 
        return { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
      case 'success': 
        return { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
      default: 
        return { icon: Info, color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/20' };
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {t('activityLogTitle')}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {t('activityLogSubtitle', { total: logs.length }).replace('{{total}}', logs.length)}
          </p>
        </div>
        <button onClick={load} className="btn-secondary py-2 px-4 w-full sm:w-auto">
          <RefreshCw size={16} />
          {t('refresh')}
        </button>
      </div>

      <div className="glass-card">
        {/* Filters */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-wrap gap-4">
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select 
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 pr-8 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-700 dark:text-slate-200 appearance-none min-w-[140px]"
            >
              <option value="all">{t('allLevels')}</option>
              <option value="info">{t('info')}</option>
              <option value="success">{t('success')}</option>
              <option value="warning">{t('warning')}</option>
              <option value="error">{t('error')}</option>
            </select>
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder={t('searchLogs')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-700 dark:text-slate-200"
            />
          </div>
        </div>

        {/* List */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Info size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-sm font-medium">{t('noLogEntries')}</p>
            </div>
          ) : (
            filtered.map((log) => {
              const conf = getStatusConfig(log.status);
              const Icon = conf.icon;
              return (
                <div key={log.id} className="p-4 flex items-start gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <div className={`mt-0.5 p-2 rounded-full ${conf.bg} ${conf.color}`}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white leading-snug mb-1">
                      {log.message}
                    </p>
                    <p className="text-xs font-mono text-slate-500">
                      {(log.timestamp || '').slice(0, 19).replace('T', ' ')}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider whitespace-nowrap ${conf.bg} ${conf.color} ${conf.border}`}>
                      {t(log.status) || log.status}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
