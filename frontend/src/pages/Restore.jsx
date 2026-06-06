import { useState, useEffect, useCallback } from 'react';
import { 
  RotateCcw, RefreshCw, AlertCircle, CheckCircle2, X,
  FileText, Server, Loader2, ArrowRight
} from 'lucide-react';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

export default function Restore() {
  const [backups, setBackups] = useState([]);
  const [connections, setConnections] = useState([]);
  const [sshConns, setSshConns] = useState([]);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const [restoreType, setRestoreType] = useState('original');
  const [target, setTarget] = useState({ connectionId: '', database: '', vmName: '', host: '', user: '', password: '', targetPath: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const [restoring, setRestoring] = useState(false);
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/backups?limit=500`).then(r => r.json()).then(data => {
      const b = data?.data || (Array.isArray(data) ? data : []);
      setBackups(b.filter(x => x.status === 'completed' && x.resultFile));
    }).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/db-connections`).then(r => r.json()).then(data => setConnections(Array.isArray(data) ? data : [])).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/ssh-connections`).then(r => r.json()).then(data => setSshConns(Array.isArray(data) ? data : [])).catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const startRestore = async () => {
    if (!selected) { showSnack(t('restorePoint') || 'Select a restore point', 'warning'); return; }
    setRestoring(true);
    const backupType = selected.backupType || selected.type;
    const config = restoreType === 'new'
      ? (['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'].includes(backupType) || backupType === 'ssh-db'
        ? { connectionId: target.connectionId, database: target.database, type: target.dbType }
        : backupType === 'ssh'
          ? { connectionId: target.connectionId, targetPath: target.targetPath }
          : backupType === 'host'
            ? { targetPath: target.targetPath }
            : backupType === 'cloud'
              ? { localPath: target.targetPath }
              : { vmName: target.vmName, host: target.host, user: target.user, password: target.password })
      : {};

    try {
      const r = await fetch(`${API}/api/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId: selected.id, targetType: restoreType, config }),
      });
      await r.json();
      showSnack(t('restoreSuccess') || 'Restore started successfully', 'success');
      setStep(0);
      setSelected(null);
    } catch {
      showSnack(t('restoreFailed') || 'Restore failed', 'error');
    }
    setRestoring(false);
  };

  const backupType = selected?.backupType || selected?.type;
  const isDB = ['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'].includes(backupType);
  const isVM = ['vmware', 'hyperv'].includes(backupType);
  const isHost = backupType === 'host' || backupType === 'ssh';
  const isSsh = backupType === 'ssh' || backupType === 'ssh-db';

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {t('restore') || 'Restore Data'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {t('restoreSubtitle') || 'Recover data from existing backups'}
          </p>
        </div>
        <button onClick={load} className="btn-secondary py-2.5 px-4 w-full sm:w-auto">
          <RefreshCw size={16} />
          {t('refresh') || 'Refresh'}
        </button>
      </div>

      {/* Stepper */}
      <div className="mb-8">
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-slate-200 dark:bg-slate-700 -z-10"></div>
          {[
            { label: t('restorePoint') || 'Restore Point', num: 1 },
            { label: 'Configure', num: 2 },
            { label: t('confirm') || 'Confirm', num: 3 }
          ].map((s, i) => (
            <div key={i} className="flex flex-col items-center bg-slate-50 dark:bg-slate-900 px-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                step === i 
                  ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30'
                  : step > i 
                    ? 'bg-blue-600 border-blue-600 text-white' 
                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400'
              }`}>
                {step > i ? <CheckCircle2 size={16} /> : s.num}
              </div>
              <span className={`text-xs font-semibold mt-2 ${
                step >= i ? 'text-slate-900 dark:text-white' : 'text-slate-500'
              }`}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Step 0: Select Restore Point */}
      {step === 0 && (
        <div className="glass-card overflow-hidden animate-fade-in">
          {backups.length === 0 ? (
            <div className="p-16 text-center text-slate-500">
              <RotateCcw size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-sm font-medium">{t('noBackupsConfigured') || 'No completed backups available to restore'}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                      <th className="p-4 w-12"></th>
                      <th className="p-4 font-semibold">{t('name') || 'Name'}</th>
                      <th className="p-4 font-semibold">{t('type') || 'Type'}</th>
                      <th className="p-4 font-semibold">{t('status') || 'Completed Date'}</th>
                      <th className="p-4 font-semibold">{t('sourcePath') || 'Source'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                    {backups.map(b => (
                      <tr 
                        key={b.id} 
                        onClick={() => setSelected(b)}
                        className={`cursor-pointer transition-colors ${
                          selected?.id === b.id 
                            ? 'bg-blue-50/50 dark:bg-blue-900/20' 
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="p-4 text-center">
                          <input 
                            type="radio" 
                            name="backup-select" 
                            checked={selected?.id === b.id} 
                            onChange={() => setSelected(b)} 
                            className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600"
                          />
                        </td>
                        <td className="p-4 font-bold text-slate-900 dark:text-white text-sm">
                          {b.name}
                        </td>
                        <td className="p-4">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 uppercase tracking-wider">
                            {b.backupType || b.type}
                          </span>
                        </td>
                        <td className="p-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                          {(b.completedAt || '').slice(0, 19).replace('T', ' ')}
                        </td>
                        <td className="p-4">
                          <span className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded inline-block max-w-[200px] truncate">
                            {b.source}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-end">
                <button 
                  onClick={() => setStep(1)} 
                  disabled={!selected}
                  className="btn-primary px-6 py-2 disabled:opacity-50"
                >
                  Next <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 1: Configure */}
      {step === 1 && (
        <div className="glass-card animate-fade-in">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <RotateCcw size={20} className="text-blue-500" />
              Configure Restore: {selected?.name}
            </h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-3">
                Restore destination
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className={`flex items-start p-4 border rounded-xl cursor-pointer transition-colors ${
                  restoreType === 'original' 
                    ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-500' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-blue-300'
                }`}>
                  <input 
                    type="radio" 
                    name="restore-type" 
                    value="original"
                    checked={restoreType === 'original'}
                    onChange={e => setRestoreType(e.target.value)}
                    className="mt-1 w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                  />
                  <div className="ml-3">
                    <span className="block text-sm font-bold text-slate-900 dark:text-white">Original Location</span>
                    <span className="block text-xs text-slate-500 mt-1">Overwrite the original data source. Use with caution.</span>
                  </div>
                </label>
                
                <label className={`flex items-start p-4 border rounded-xl cursor-pointer transition-colors ${
                  restoreType === 'new' 
                    ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-500' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-blue-300'
                }`}>
                  <input 
                    type="radio" 
                    name="restore-type" 
                    value="new"
                    checked={restoreType === 'new'}
                    onChange={e => setRestoreType(e.target.value)}
                    className="mt-1 w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                  />
                  <div className="ml-3">
                    <span className="block text-sm font-bold text-slate-900 dark:text-white">New Location</span>
                    <span className="block text-xs text-slate-500 mt-1">Restore data to a different path, database, or server.</span>
                  </div>
                </label>
              </div>
            </div>

            {restoreType === 'new' && (
              <div className="p-5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4 animate-fade-in">
                {isDB && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('targetConnection') || 'Target Connection'}</label>
                      <select 
                        value={target.connectionId} 
                        onChange={e => setTarget({...target, connectionId: e.target.value})}
                        className="input-field py-2"
                      >
                        <option value="" disabled>Select connection...</option>
                        {connections.filter(c => c.type === backupType).map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Target Database</label>
                      <input 
                        type="text" 
                        value={target.database} 
                        onChange={e => setTarget({...target, database: e.target.value})} 
                        placeholder="new_database_name" 
                        className="input-field" 
                      />
                    </div>
                  </>
                )}
                
                {backupType === 'ssh-db' && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('targetConnection') || 'Target SSH'}</label>
                      <select 
                        value={target.connectionId} 
                        onChange={e => setTarget({...target, connectionId: e.target.value})}
                        className="input-field py-2"
                      >
                        <option value="" disabled>Select SSH connection...</option>
                        {sshConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.host})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">DB Type</label>
                      <select 
                        value={target.dbType || 'mysql'} 
                        onChange={e => setTarget({...target, dbType: e.target.value})}
                        className="input-field py-2"
                      >
                        <option value="mysql">MySQL</option>
                        <option value="postgres">PostgreSQL</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Target Database</label>
                      <input 
                        type="text" 
                        value={target.database} 
                        onChange={e => setTarget({...target, database: e.target.value})} 
                        placeholder="db_name" 
                        className="input-field" 
                      />
                    </div>
                  </>
                )}
                
                {isVM && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">New VM Name</label>
                      <input 
                        type="text" 
                        value={target.vmName} 
                        onChange={e => setTarget({...target, vmName: e.target.value})} 
                        placeholder="my-vm-restored" 
                        className="input-field" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('host') || 'Host'}</label>
                      <input type="text" value={target.host} onChange={e => setTarget({...target, host: e.target.value})} className="input-field" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('username') || 'Username'}</label>
                        <input type="text" value={target.user} onChange={e => setTarget({...target, user: e.target.value})} className="input-field" />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('password') || 'Password'}</label>
                        <input type="password" value={target.password} onChange={e => setTarget({...target, password: e.target.value})} className="input-field" />
                      </div>
                    </div>
                  </>
                )}
                
                {isHost && (
                  <>
                    {isSsh && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('targetConnection') || 'Target SSH'}</label>
                        <select 
                          value={target.connectionId} 
                          onChange={e => setTarget({...target, connectionId: e.target.value})}
                          className="input-field py-2"
                        >
                          <option value="" disabled>Select SSH connection...</option>
                          {sshConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.host})</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('targetPath') || 'Target Path'}
                      </label>
                      <input 
                        type="text" 
                        value={target.targetPath} 
                        onChange={e => setTarget({...target, targetPath: e.target.value})} 
                        placeholder="/restore/host" 
                        className="input-field" 
                      />
                      <p className="text-xs text-slate-500 mt-1.5">
                        {isSsh ? "Archive will be extracted on the remote server via SSH." : "Host archive will be extracted to this directory."}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          
          <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-between">
            <button onClick={() => setStep(0)} className="btn-secondary px-5 py-2">Back</button>
            <button onClick={() => setStep(2)} className="btn-primary px-6 py-2">Next <ArrowRight size={16} /></button>
          </div>
        </div>
      )}

      {/* Step 2: Confirm */}
      {step === 2 && (
        <div className="glass-card animate-fade-in max-w-2xl mx-auto">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 size={20} className="text-emerald-500" />
              Confirm Restore
            </h3>
          </div>
          
          {restoring && (
            <div className="h-1 w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className="h-full bg-blue-600 animate-[progress_2s_ease-in-out_infinite] origin-left" style={{ width: '50%' }}></div>
            </div>
          )}
          
          <div className="p-6 space-y-4">
            <div className="flex gap-4 items-start p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
              <div className="p-2 bg-blue-500/10 text-blue-600 rounded-lg">
                <FileText size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Backup Source</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{selected?.name}</p>
                <p className="text-xs font-medium text-slate-500 mt-1 uppercase">{selected?.backupType || selected?.type}</p>
                {selected?.resultFile && (
                  <p className="text-xs font-mono text-slate-600 dark:text-slate-400 mt-2 bg-white dark:bg-slate-900 px-2 py-1 rounded inline-block truncate max-w-full border border-slate-200 dark:border-slate-700">
                    {selected.resultFile}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-4 items-start p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
              <div className={`p-2 rounded-lg ${restoreType === 'original' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                {restoreType === 'original' ? <AlertCircle size={24} /> : <Server size={24} />}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Destination</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {restoreType === 'original' ? 'Original Location' : 'New Location'}
                </p>
                {restoreType === 'original' && (
                  <p className="text-xs font-medium text-amber-600 mt-1">
                    Warning: This will overwrite existing data at the original source.
                  </p>
                )}
              </div>
            </div>
          </div>
          
          <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-between">
            <button onClick={() => setStep(1)} disabled={restoring} className="btn-secondary px-5 py-2 disabled:opacity-50">Back</button>
            <button onClick={startRestore} disabled={restoring} className="btn-primary px-6 py-2 disabled:opacity-50">
              {restoring ? (
                <><Loader2 size={16} className="animate-spin" /> Restoring...</>
              ) : (
                <><RotateCcw size={16} /> {t('restoreBtn') || 'Start Restore'}</>
              )}
            </button>
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
