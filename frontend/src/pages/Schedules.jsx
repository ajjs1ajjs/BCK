import { useState, useEffect, useCallback } from 'react';
import { 
  CalendarClock, Plus, Trash2, Edit2, RefreshCw, 
  AlertCircle, CheckCircle2, X, Clock, PlayCircle
} from 'lucide-react';
import { useTranslation } from '../context/LangContext';
import { useAuth } from '../context/AuthContext';
import { API } from '../utils/config';

export default function Schedules() {
  const [schedules, setSchedules] = useState([]);
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', cronExpression: '0 0 * * *', backupId: '', enabled: true, notifyOn: 'failure', description: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { t, lang } = useTranslation();
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  // Builder states
  const [builderType, setBuilderType] = useState('daily');
  const [builderHourly, setBuilderHourly] = useState('1');
  const [builderMin, setBuilderMin] = useState('0');
  const [builderTime, setBuilderTime] = useState('00:00');
  const [builderDay, setBuilderDay] = useState('0');
  const [builderDate, setBuilderDate] = useState('1');

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const explainCron = (cron) => {
    if (!cron) return '';
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return lang === 'uk' ? 'Складний розклад' : 'Advanced schedule';

    const [min, hour, dom, month, dow] = parts;
    const isUk = lang === 'uk';
    const pad = (n) => String(n).padStart(2, '0');

    const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const daysUk = ['неділю', 'понеділок', 'вівторок', 'середу', 'четвер', 'п\'ятницю', 'суботу'];

    if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return isUk ? 'Щогодини' : 'Every hour';
    }
    if (hour === '*' && dom === '*' && month === '*') {
      return isUk ? `Щогодини на ${min}-й хвилині` : `Every hour at minute ${min}`;
    }
    if (hour.startsWith('*/') && dom === '*' && month === '*') {
      const h = hour.split('/')[1];
      return isUk ? `Кожні ${h} год. на ${min}-й хвилині` : `Every ${h} hours at minute ${min}`;
    }
    if (dom === '*' && month === '*' && dow === '*') {
      return isUk ? `Щодня о ${pad(hour)}:${pad(min)}` : `Daily at ${pad(hour)}:${pad(min)}`;
    }
    if (dom === '*' && month === '*' && dow !== '*') {
      const dayName = isUk ? daysUk[parseInt(dow)] || dow : daysEn[parseInt(dow)] || dow;
      return isUk ? `Щотижня у ${dayName} о ${pad(hour)}:${pad(min)}` : `Weekly on ${dayName} at ${pad(hour)}:${pad(min)}`;
    }
    if (dom !== '*' && month === '*' && dow === '*') {
      return isUk ? `Щомісяця ${dom}-го числа о ${pad(hour)}:${pad(min)}` : `Monthly on day ${dom} at ${pad(hour)}:${pad(min)}`;
    }

    return isUk ? `Користувацький розклад (${cron})` : `Custom schedule (${cron})`;
  };

  const parseCronToForm = (cron) => {
    const parts = (cron || '0 0 * * *').trim().split(/\s+/);
    if (parts.length !== 5) return { type: 'advanced', hourly: '1', min: '0', time: '00:00', day: '0', date: '1' };
    const [min, hour, dom, month, dow] = parts;

    if (hour === '*' && dom === '*' && month === '*') {
      return { type: 'hourly', hourly: '1', min: min, time: '00:00', day: '0', date: '1' };
    }
    if (hour.startsWith('*/') && dom === '*' && month === '*') {
      return { type: 'hourly', hourly: hour.split('/')[1], min: min, time: '00:00', day: '0', date: '1' };
    }
    if (dom === '*' && month === '*' && dow === '*') {
      const h = String(hour).padStart(2, '0');
      const m = String(min).padStart(2, '0');
      return { type: 'daily', hourly: '1', min: '0', time: `${h}:${m}`, day: '0', date: '1' };
    }
    if (dom === '*' && month === '*' && dow !== '*') {
      const h = String(hour).padStart(2, '0');
      const m = String(min).padStart(2, '0');
      return { type: 'weekly', hourly: '1', min: '0', time: `${h}:${m}`, day: dow, date: '1' };
    }
    if (dom !== '*' && month === '*' && dow === '*') {
      const h = String(hour).padStart(2, '0');
      const m = String(min).padStart(2, '0');
      return { type: 'monthly', hourly: '1', min: '0', time: `${h}:${m}`, day: '0', date: dom };
    }

    return { type: 'advanced', hourly: '1', min: '0', time: '00:00', day: '0', date: '1' };
  };

  const updateCronFromBuilder = (type, hourly, minOffset, time, day, date) => {
    let expr = '0 0 * * *';
    const [h, m] = (time || '00:00').split(':');
    const hr = parseInt(h) || 0;
    const mn = parseInt(m) || 0;

    if (type === 'hourly') {
      if (hourly === '1') {
        expr = `${minOffset} * * * *`;
      } else {
        expr = `${minOffset} */${hourly} * * *`;
      }
    } else if (type === 'daily') {
      expr = `${mn} ${hr} * * *`;
    } else if (type === 'weekly') {
      expr = `${mn} ${hr} * * ${day}`;
    } else if (type === 'monthly') {
      expr = `${mn} ${hr} ${date} * *`;
    } else if (type === 'advanced') {
      return;
    }
    setForm(prev => ({ ...prev, cronExpression: expr }));
  };

  const load = useCallback(() => {
    fetch(`${API}/api/schedules`, { headers })
      .then(r => r.json())
      .then(data => setSchedules(Array.isArray(data) ? data : []))
      .catch(e => console.error('Load error:', e));
    fetch(`${API}/api/backups`, { headers })
      .then(r => r.json())
      .then(data => setBackups(data?.data || (Array.isArray(data) ? data : [])))
      .catch(e => console.error('Load error:', e));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setBuilderType('daily');
    setBuilderHourly('1');
    setBuilderMin('0');
    setBuilderTime('00:00');
    setBuilderDay('0');
    setBuilderDate('1');
    setForm({ name: '', cronExpression: '0 0 * * *', backupId: '', enabled: true, notifyOn: 'failure', description: '' });
    setDialogOpen(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    const cron = s.cronExpression || s.cron || '0 0 * * *';
    const parsed = parseCronToForm(cron);
    setBuilderType(parsed.type);
    setBuilderHourly(parsed.hourly);
    setBuilderMin(parsed.min);
    setBuilderTime(parsed.time);
    setBuilderDay(parsed.day);
    setBuilderDate(parsed.date);
    setForm({
      name: s.name,
      cronExpression: cron,
      backupId: s.backupId || '',
      enabled: s.enabled !== false,
      notifyOn: s.notifyOn || 'failure',
      description: s.description || ''
    });
    setDialogOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name || !form.cronExpression || !form.backupId) {
      showSnack(t('allFieldsRequired'), 'warning');
      return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/schedules/${editing.id}` : `${API}/api/schedules`;
    try {
      const r = await fetch(url, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error();
      showSnack(editing ? t('scheduleUpdated') : t('scheduleCreated'), 'success');
      setDialogOpen(false);
      load();
    } catch {
      showSnack(t('failedToSave'), 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this schedule?")) return;
    try {
      await fetch(`${API}/api/schedules/${id}`, { method: 'DELETE', headers });
      showSnack(t('scheduleDeleted'), 'success');
      load();
    } catch {
      showSnack(t('failedToDelete'), 'error');
    }
  };

  const toggleEnabled = async (s) => {
    const updated = { ...s, enabled: !s.enabled };
    try {
      await fetch(`${API}/api/schedules/${s.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      load();
    } catch { /* ignore */ }
  };

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {t('schedules')}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {t('automatedSchedulesCount', { total: schedules.length }).replace('{{total}}', schedules.length)}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={load} className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
            <RefreshCw size={18} />
          </button>
          <button onClick={openCreate} className="btn-primary py-2.5 px-4 flex-1 sm:flex-none">
            <Plus size={18} />
            {t('newSchedule')}
          </button>
        </div>
      </div>

      <div className="glass-card mb-6">
        {schedules.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <CalendarClock size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm font-medium">{t('noSchedulesYet')}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {schedules.map((s) => (
              <div key={s.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  
                  {/* Left Side: Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                        {s.name}
                      </h3>
                      {s.enabled !== false ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-600 border-emerald-500/20 uppercase tracking-wider whitespace-nowrap">
                          {t('activeScheduleLabel') || 'Active'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 uppercase tracking-wider whitespace-nowrap">
                          {t('disabledScheduleLabel') || 'Disabled'}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-800/30">
                        <Clock size={14} />
                        {explainCron(s.cronExpression || s.cron)}
                      </div>
                      
                      <div className="text-slate-500 font-mono text-xs">
                        {s.cronExpression || s.cron}
                      </div>

                      {s.backupId && (
                        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                          <span className="truncate max-w-[200px]">
                            Backup: {backups.find(b => b.id === s.backupId)?.name || s.backupId}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Side: Actions */}
                  <div className="flex items-center gap-3 pl-2 border-l border-slate-200 dark:border-slate-700">
                    <label className="relative inline-flex items-center cursor-pointer mr-2">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={s.enabled !== false}
                        onChange={() => toggleEnabled(s)}
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
                    </label>
                    <button onClick={() => openEdit(s)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title={t('edit')}>
                      <Edit2 size={18} />
                    </button>
                    <button onClick={() => handleDelete(s.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete')}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 my-8" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur z-10 rounded-t-2xl">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {editing ? t('editSchedule') : t('newSchedule')}
              </h2>
              <button onClick={() => setDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-slate-100 dark:bg-slate-800 p-1.5 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-5 sm:p-6 space-y-6">
              
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('scheduleName')} <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    required 
                    value={form.name} 
                    onChange={e => setForm({...form, name: e.target.value})} 
                    placeholder="e.g. Nightly DB Backup" 
                    className="input-field" 
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('backupJob')} <span className="text-red-500">*</span>
                  </label>
                  <select 
                    required
                    value={form.backupId} 
                    onChange={e => setForm({...form, backupId: e.target.value})}
                    className="input-field"
                  >
                    <option value="" disabled>Select a backup job...</option>
                    {backups.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.type || b.backupType})</option>
                    ))}
                  </select>
                  {backups.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertCircle size={12} /> No backup jobs available — create one first
                    </p>
                  )}
                </div>
              </div>

              <hr className="border-slate-100 dark:border-slate-800" />

              {/* Schedule Builder */}
              <div className="space-y-4 bg-slate-50/50 dark:bg-slate-800/30 p-4 rounded-xl border border-slate-100 dark:border-slate-700/50">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <CalendarClock size={16} className="text-blue-500" />
                  Schedule Timing
                </h3>
                
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                    {t('cronFrequencyType')}
                  </label>
                  <select 
                    value={builderType}
                    onChange={(e) => {
                      const newType = e.target.value;
                      setBuilderType(newType);
                      updateCronFromBuilder(newType, builderHourly, builderMin, builderTime, builderDay, builderDate);
                    }}
                    className="input-field py-2"
                  >
                    <option value="hourly">{t('cronHourly') || 'Hourly'}</option>
                    <option value="daily">{t('cronDaily') || 'Daily'}</option>
                    <option value="weekly">{t('cronWeekly') || 'Weekly'}</option>
                    <option value="monthly">{t('cronMonthly') || 'Monthly'}</option>
                    <option value="advanced">{t('cronAdvanced') || 'Advanced (Cron)'}</option>
                  </select>
                </div>

                {builderType === 'hourly' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">{t('everyXHours') || 'Every X Hours'}</label>
                      <select 
                        value={builderHourly}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBuilderHourly(v);
                          updateCronFromBuilder(builderType, v, builderMin, builderTime, builderDay, builderDate);
                        }}
                        className="input-field py-2"
                      >
                        {['1', '2', '3', '4', '6', '8', '12'].map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">{t('atMinute') || 'At Minute'}</label>
                      <select 
                        value={builderMin}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBuilderMin(v);
                          updateCronFromBuilder(builderType, builderHourly, v, builderTime, builderDay, builderDate);
                        }}
                        className="input-field py-2"
                      >
                        {['0', '5', '10', '15', '20', '30', '45'].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {(builderType === 'daily' || builderType === 'weekly' || builderType === 'monthly') && (
                  <div className="space-y-3">
                    {builderType === 'weekly' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">{t('dayOfWeek') || 'Day of Week'}</label>
                        <select 
                          value={builderDay}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBuilderDay(v);
                            updateCronFromBuilder(builderType, builderHourly, builderMin, builderTime, v, builderDate);
                          }}
                          className="input-field py-2"
                        >
                          {[
                            { label: lang === 'uk' ? 'Неділя' : 'Sunday', value: '0' },
                            { label: lang === 'uk' ? 'Понеділок' : 'Monday', value: '1' },
                            { label: lang === 'uk' ? 'Вівторок' : 'Tuesday', value: '2' },
                            { label: lang === 'uk' ? 'Середа' : 'Wednesday', value: '3' },
                            { label: lang === 'uk' ? 'Четвер' : 'Thursday', value: '4' },
                            { label: lang === 'uk' ? 'П\'ятниця' : 'Friday', value: '5' },
                            { label: lang === 'uk' ? 'Субота' : 'Saturday', value: '6' },
                          ].map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      </div>
                    )}
                    {builderType === 'monthly' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">{t('dayOfMonth') || 'Day of Month'}</label>
                        <select 
                          value={builderDate}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBuilderDate(v);
                            updateCronFromBuilder(builderType, builderHourly, builderMin, builderTime, builderDay, v);
                          }}
                          className="input-field py-2"
                        >
                          {Array.from({ length: 28 }, (_, i) => String(i + 1)).map(d => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">{t('runTime') || 'Run Time'}</label>
                      <input 
                        type="time" 
                        value={builderTime}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBuilderTime(v);
                          updateCronFromBuilder(builderType, builderHourly, builderMin, v, builderDay, builderDate);
                        }}
                        className="input-field py-2"
                      />
                    </div>
                  </div>
                )}

                {builderType === 'advanced' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">{t('cronExpressionCustom') || 'Cron Expression'}</label>
                    <input 
                      type="text" 
                      value={form.cronExpression}
                      onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}
                      placeholder="0 */6 * * *"
                      className="input-field py-2 font-mono"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">{t('cronHelper') || 'Standard 5-part cron syntax (minute, hour, day of month, month, day of week)'}</p>
                  </div>
                )}

                {/* Preview Box */}
                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-lg flex gap-3 items-start">
                  <PlayCircle className="text-blue-500 mt-0.5 flex-shrink-0" size={16} />
                  <div>
                    <p className="text-xs text-blue-900 dark:text-blue-300 font-medium">
                      {t('currentSchedule') || 'Will run:'}
                    </p>
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-400 mt-0.5 leading-snug">
                      {explainCron(form.cronExpression)}
                    </p>
                    <p className="text-[10px] font-mono text-blue-500 dark:text-blue-500/70 mt-1">
                      {form.cronExpression || '—'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Extra Settings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-700/50 rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('enabledCol') || 'Enabled'}</p>
                    <p className="text-xs text-slate-500">Run this schedule automatically</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={form.enabled !== false}
                      onChange={e => setForm({...form, enabled: e.target.checked})}
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('notifyOn') || 'Notifications'}
                  </label>
                  <select 
                    value={form.notifyOn || 'failure'} 
                    onChange={e => setForm({...form, notifyOn: e.target.value})}
                    className="input-field py-2"
                  >
                    <option value="never">Never</option>
                    <option value="failure">Failure only</option>
                    <option value="all">All results (Success & Failure)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('descriptionOptional') || 'Description (Optional)'}
                  </label>
                  <textarea 
                    value={form.description || ''} 
                    onChange={e => setForm({...form, description: e.target.value})}
                    placeholder="Notes about this schedule"
                    rows="2"
                    className="input-field resize-none"
                  ></textarea>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 sticky bottom-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur pb-2 -mx-5 px-5 sm:-mx-6 sm:px-6">
                <button type="button" onClick={() => setDialogOpen(false)} className="btn-secondary px-5 py-2">
                  {t('cancel') || 'Cancel'}
                </button>
                <button type="submit" className="btn-primary px-6 py-2">
                  {editing ? (t('save') || 'Save Changes') : (t('create') || 'Create Schedule')}
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
