import { useState } from 'react';
import { 
  ShieldCheck, Plus, Trash2, Edit2, Play, RefreshCw, 
  AlertCircle, CheckCircle2, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';

const DEFAULT_POLICIES = [
  { id: '1', name: 'Daily Backup', description: 'Daily full backup with 7-day retention', type: 'full', retentionDays: 7, retentionCopies: 7, schedule: '0 2 * * *', enabled: true, targets: ['mysql', 'postgres'] },
  { id: '2', name: 'Weekly Archive', description: 'Weekly archive with 30-day retention', type: 'full', retentionDays: 30, retentionCopies: 4, schedule: '0 3 * * 0', enabled: true, targets: ['mysql', 'postgres', 'vmware'] },
  { id: '3', name: 'Monthly Compliance', description: 'Monthly backup for compliance (90 days)', type: 'full', retentionDays: 90, retentionCopies: 12, schedule: '0 4 1 * *', enabled: false, targets: ['all'] },
  { id: '4', name: 'Incremental Every 6h', description: 'Incremental backup every 6 hours', type: 'incremental', retentionDays: 3, retentionCopies: 12, schedule: '0 */6 * * *', enabled: false, targets: ['mysql'] },
];

const POLICY_SCHEDULES = [
  {
    value: '0 2 * * *',
    label: { en: 'Every day at 02:00', uk: 'Щодня о 02:00' },
    helper: { en: 'Best for nightly backups.', uk: 'Зручно для нічних копій.' },
  },
  {
    value: '0 3 * * 0',
    label: { en: 'Every Sunday at 03:00', uk: 'Щонеділі о 03:00' },
    helper: { en: 'Best for weekly archives.', uk: 'Зручно для тижневих архівів.' },
  },
  {
    value: '0 4 1 * *',
    label: { en: 'On the 1st day monthly at 04:00', uk: '1-го числа щомісяця о 04:00' },
    helper: { en: 'Best for monthly retention policies.', uk: 'Зручно для місячного зберігання.' },
  },
  {
    value: '0 */6 * * *',
    label: { en: 'Every 6 hours', uk: 'Кожні 6 годин' },
    helper: { en: 'Best for frequent incremental backups.', uk: 'Зручно для частих інкрементальних копій.' },
  },
  {
    value: '0 */4 * * *',
    label: { en: 'Every 4 hours', uk: 'Кожні 4 години' },
    helper: { en: 'For systems with frequent changes.', uk: 'Для систем із частими змінами.' },
  },
  {
    value: '0 */12 * * *',
    label: { en: 'Every 12 hours', uk: 'Кожні 12 годин' },
    helper: { en: 'Balanced daytime and nighttime coverage.', uk: 'Збалансований запуск вдень і вночі.' },
  },
  {
    value: '0 2 * * 1-5',
    label: { en: 'Weekdays at 02:00', uk: 'У будні о 02:00' },
    helper: { en: 'Runs Monday through Friday.', uk: 'Запускається з понеділка по пʼятницю.' },
  },
  {
    value: '0 1 * * 6,0',
    label: { en: 'Weekend at 01:00', uk: 'На вихідних о 01:00' },
    helper: { en: 'Runs on Saturday and Sunday.', uk: 'Запускається в суботу та неділю.' },
  },
  {
    value: '30 23 * * *',
    label: { en: 'Every day at 23:30', uk: 'Щодня о 23:30' },
    helper: { en: 'Useful before nightly maintenance windows.', uk: 'Зручно перед нічним технічним вікном.' },
  },
];

const getPolicySchedule = (schedule) => (
  POLICY_SCHEDULES.find(option => option.value === schedule)
);

const DEFAULT_CUSTOM_DAYS = ['1', '2', '3', '4', '5'];

const expandCronDays = (value) => {
  if (!value || value === '*') return ['0', '1', '2', '3', '4', '5', '6'];
  if (value === '1-5') return ['1', '2', '3', '4', '5'];
  return value.split(',').filter(day => ['0', '1', '2', '3', '4', '5', '6'].includes(day));
};

const parsePolicySchedule = (schedule) => {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = (schedule || '').trim().split(/\s+/);
  if (!minute || !hour || dayOfMonth !== '*' || month !== '*' || hour.includes('/')) {
    return { days: DEFAULT_CUSTOM_DAYS, time: '02:00' };
  }
  const normalizedHour = String(parseInt(hour, 10)).padStart(2, '0');
  const normalizedMinute = String(parseInt(minute, 10)).padStart(2, '0');
  return {
    days: expandCronDays(dayOfWeek),
    time: `${normalizedHour}:${normalizedMinute}`,
  };
};

const buildCustomSchedule = (days, time) => {
  const selectedDays = days.length ? days : DEFAULT_CUSTOM_DAYS;
  const [hour = '02', minute = '00'] = (time || '02:00').split(':');
  const dayPart = selectedDays.length === 7 ? '*' : selectedDays.join(',');
  return `${parseInt(minute, 10)} ${parseInt(hour, 10)} * * ${dayPart}`;
};

export default function Policies() {
  const [policies, setPolicies] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bck-policies')) || DEFAULT_POLICIES; }
    catch { return DEFAULT_POLICIES; }
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', type: 'full', retentionDays: 30, retentionCopies: 10, schedule: '0 2 * * *', targets: [] });
  const [customDays, setCustomDays] = useState(DEFAULT_CUSTOM_DAYS);
  const [customTime, setCustomTime] = useState('02:00');
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { can } = useAuth();
  const { t, lang } = useTranslation();
  const isUk = lang === 'uk';
  const dayLabels = [
    { value: '1', label: isUk ? 'Пн' : 'Mon' },
    { value: '2', label: isUk ? 'Вт' : 'Tue' },
    { value: '3', label: isUk ? 'Ср' : 'Wed' },
    { value: '4', label: isUk ? 'Чт' : 'Thu' },
    { value: '5', label: isUk ? 'Пт' : 'Fri' },
    { value: '6', label: isUk ? 'Сб' : 'Sat' },
    { value: '0', label: isUk ? 'Нд' : 'Sun' },
  ];
  
  const scheduleOptionValue = getPolicySchedule(form.schedule)?.value || 'custom';
  
  const scheduleLabel = (schedule) => {
    const option = getPolicySchedule(schedule);
    if (option) return option.label[isUk ? 'uk' : 'en'];
    const parsed = parsePolicySchedule(schedule);
    const allDays = parsed.days.length === 7;
    const selectedLabels = dayLabels
      .filter(day => parsed.days.includes(day.value))
      .map(day => day.label)
      .join(', ');
    if (allDays) return isUk ? `Щодня о ${parsed.time}` : `Every day at ${parsed.time}`;
    return isUk ? `${selectedLabels} о ${parsed.time}` : `${selectedLabels} at ${parsed.time}`;
  };
  
  const scheduleHelper = (schedule) => {
    const option = getPolicySchedule(schedule);
    if (option) return option.helper[isUk ? 'uk' : 'en'];
    return isUk ? 'Оберіть дні тижня та час запуску.' : 'Choose weekdays and run time.';
  };

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const persist = (items) => {
    localStorage.setItem('bck-policies', JSON.stringify(items));
    setPolicies(items);
  };

  const openCreate = () => {
    setEditing(null);
    setCustomDays(DEFAULT_CUSTOM_DAYS);
    setCustomTime('02:00');
    setForm({ name: '', description: '', type: 'full', retentionDays: 30, retentionCopies: 10, schedule: '0 2 * * *', targets: [] });
    setDialogOpen(true);
  };
  
  const openEdit = (p) => {
    setEditing(p);
    const parsed = parsePolicySchedule(p.schedule);
    setCustomDays(parsed.days);
    setCustomTime(parsed.time);
    setForm({ name: p.name, description: p.description, type: p.type, retentionDays: p.retentionDays, retentionCopies: p.retentionCopies, schedule: p.schedule, targets: p.targets || [] });
    setDialogOpen(true);
  };

  const save = (e) => {
    e.preventDefault();
    if (!form.name) { 
      showSnack(t('nameRequired') || 'Name is required', 'warning'); 
      return; 
    }
    const item = { ...form, id: editing?.id || Date.now().toString(), enabled: editing?.enabled ?? true };
    if (editing) {
      persist(policies.map(p => p.id === editing.id ? item : p));
    } else {
      persist([...policies, item]);
    }
    setDialogOpen(false);
    showSnack(editing ? (t('policyUpdated') || 'Policy updated') : (t('policyCreated') || 'Policy created'), 'success');
  };

  const remove = (id) => {
    if(!window.confirm("Are you sure you want to delete this policy?")) return;
    persist(policies.filter(p => p.id !== id));
    showSnack(t('policyDeleted') || 'Policy deleted', 'success');
  };

  const toggle = (id) => {
    persist(policies.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  const applyToBackups = (policy) => {
    showSnack(t('policyApplied', { name: policy.name })?.replace('{{name}}', policy.name) || `Policy ${policy.name} applied`, 'info');
  };

  // Select Targets Multiple logic
  const toggleTarget = (value) => {
    const targets = form.targets || [];
    if (value === 'all') {
      setForm({ ...form, targets: targets.includes('all') ? [] : ['all'] });
      return;
    }
    let newTargets = [...targets];
    if (newTargets.includes('all')) newTargets = [];
    
    if (newTargets.includes(value)) {
      newTargets = newTargets.filter(t => t !== value);
    } else {
      newTargets.push(value);
    }
    setForm({ ...form, targets: newTargets });
  };

  const ALL_TARGET_TYPES = [
    { value: 'all', label: 'All types' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'postgres', label: 'PostgreSQL' },
    { value: 'oracle', label: 'Oracle' },
    { value: 'mongodb', label: 'MongoDB' },
    { value: 'mssql', label: 'MS SQL Server' },
    { value: 'redis', label: 'Redis' },
    { value: 'vmware', label: 'VMware' },
    { value: 'hyperv', label: 'Hyper-V' },
    { value: 'cloud', label: 'Cloud Storage' },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {t('policiesTitle') || 'Backup Policies'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {t('policiesSubtitle') || 'Manage retention rules and backup schedules globally'}
          </p>
        </div>
        {can('manageBackups') && (
          <div className="flex gap-2 w-full sm:w-auto">
            <button className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
              <RefreshCw size={18} />
            </button>
            <button onClick={openCreate} className="btn-primary py-2.5 px-4 flex-1 sm:flex-none">
              <Plus size={18} />
              {t('newPolicy') || 'New Policy'}
            </button>
          </div>
        )}
      </div>

      <div className="glass-card mb-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="p-4 font-semibold">{t('policy') || 'Policy'}</th>
                <th className="p-4 font-semibold">{t('type') || 'Type'}</th>
                <th className="p-4 font-semibold">{t('retention') || 'Retention'}</th>
                <th className="p-4 font-semibold">{t('schedule') || 'Schedule'}</th>
                <th className="p-4 font-semibold">{t('targets') || 'Targets'}</th>
                <th className="p-4 font-semibold">{t('enabledCol') || 'Enabled'}</th>
                <th className="p-4 font-semibold text-right">{t('actions') || 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {policies.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                  <td className="p-4 min-w-[200px]">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{p.name}</h3>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">{p.description}</p>
                  </td>
                  <td className="p-4">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                      p.type === 'full' 
                        ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                        : 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20'
                    }`}>
                      {p.type}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      <span className="font-bold text-slate-900 dark:text-white">{p.retentionDays}</span> days / 
                      <span className="font-bold text-slate-900 dark:text-white ml-1">{p.retentionCopies}</span> copies
                    </div>
                  </td>
                  <td className="p-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {scheduleLabel(p.schedule)}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1 max-w-[150px]">
                      {p.targets?.map(t => (
                        <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 uppercase tracking-wider">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={p.enabled}
                        onChange={() => toggle(p.id)}
                        disabled={!can('manageBackups')}
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 opacity-50 peer-disabled:opacity-30 peer-checked:opacity-100"></div>
                    </label>
                  </td>
                  <td className="p-4 text-right whitespace-nowrap">
                    {can('manageBackups') && (
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => applyToBackups(p)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('apply') || 'Apply'}>
                          <Play size={18} />
                        </button>
                        <button onClick={() => openEdit(p)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title={t('edit') || 'Edit'}>
                          <Edit2 size={18} />
                        </button>
                        <button onClick={() => remove(p.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete') || 'Delete'}>
                          <Trash2 size={18} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 my-8" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur z-10 rounded-t-2xl">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck size={20} className="text-blue-500" />
                {editing ? (t('editPolicy') || 'Edit Policy') : (t('newPolicyTitle') || 'New Policy')}
              </h2>
              <button onClick={() => setDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-slate-100 dark:bg-slate-800 p-1.5 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={save} className="p-5 sm:p-6 space-y-5">
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('policyName') || 'Policy Name'} <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    required 
                    value={form.name} 
                    onChange={e => setForm({...form, name: e.target.value})} 
                    className="input-field" 
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('description') || 'Description'}
                  </label>
                  <textarea 
                    value={form.description} 
                    onChange={e => setForm({...form, description: e.target.value})}
                    rows="2"
                    className="input-field resize-none"
                  ></textarea>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('backupType') || 'Backup Type'}
                  </label>
                  <select 
                    value={form.type} 
                    onChange={e => setForm({...form, type: e.target.value})}
                    className="input-field py-2.5"
                  >
                    <option value="full">Full</option>
                    <option value="incremental">Incremental</option>
                    <option value="differential">Differential</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('targetTypes') || 'Target Types'}
                  </label>
                  <div className="relative">
                    <div className="input-field py-2 flex flex-wrap gap-1 min-h-[42px] cursor-pointer items-center overflow-hidden">
                      {form.targets?.length === 0 && <span className="text-slate-400 text-sm">Select targets...</span>}
                      {form.targets?.map(t => (
                        <span key={t} className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-600 border-blue-500/20 uppercase tracking-wider">
                          {ALL_TARGET_TYPES.find(x => x.value === t)?.label || t}
                        </span>
                      ))}
                      <select 
                        multiple
                        value={form.targets || []} 
                        onChange={(e) => {
                          const options = Array.from(e.target.options);
                          const lastSelected = options.find(o => o.selected && !(form.targets || []).includes(o.value));
                          const lastDeselected = options.find(o => !o.selected && (form.targets || []).includes(o.value));
                          if (lastSelected) toggleTarget(lastSelected.value);
                          if (lastDeselected) toggleTarget(lastDeselected.value);
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      >
                        {ALL_TARGET_TYPES.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('retentionDays') || 'Retention (Days)'}
                  </label>
                  <input 
                    type="number" 
                    min="1"
                    value={form.retentionDays} 
                    onChange={e => setForm({...form, retentionDays: parseInt(e.target.value) || 1})} 
                    className="input-field py-2.5" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('minCopiesToKeep') || 'Min Copies'}
                  </label>
                  <input 
                    type="number"
                    min="1"
                    value={form.retentionCopies} 
                    onChange={e => setForm({...form, retentionCopies: parseInt(e.target.value) || 1})} 
                    className="input-field py-2.5" 
                  />
                </div>
              </div>

              <hr className="border-slate-100 dark:border-slate-800" />

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isUk ? 'Коли запускати' : 'When to run'}
                  </label>
                  <select 
                    value={scheduleOptionValue}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'custom') {
                        setForm({ ...form, schedule: buildCustomSchedule(customDays, customTime) });
                      } else {
                        const parsed = parsePolicySchedule(value);
                        setCustomDays(parsed.days);
                        setCustomTime(parsed.time);
                        setForm({ ...form, schedule: value });
                      }
                    }}
                    className="input-field py-2.5 mb-1"
                  >
                    {POLICY_SCHEDULES.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label[isUk ? 'uk' : 'en']}
                      </option>
                    ))}
                    <option value="custom">{isUk ? 'Власний розклад' : 'Custom schedule'}</option>
                  </select>
                  <p className="text-[11px] font-medium text-slate-500">{scheduleHelper(form.schedule)}</p>
                </div>

                {scheduleOptionValue === 'custom' && (
                  <div className="p-4 bg-slate-50/50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-700/50 rounded-xl space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                        {isUk ? 'Власний розклад' : 'Custom schedule'}
                        <span className="block font-normal text-slate-500">
                          {isUk ? 'Оберіть дні, коли має запускатися політика, і точний час.' : 'Choose the days this policy should run and the exact time.'}
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {dayLabels.map(day => {
                          const selected = customDays.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => {
                                if (selected && customDays.length === 1) return;
                                const nextDays = selected
                                  ? customDays.filter(value => value !== day.value)
                                  : [...customDays, day.value];
                                setCustomDays(nextDays);
                                setForm({ ...form, schedule: buildCustomSchedule(nextDays, customTime) });
                              }}
                              className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                                selected 
                                  ? 'bg-blue-600 border-blue-600 text-white' 
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                              }`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                          {isUk ? 'Час запуску' : 'Run time'}
                        </label>
                        <input
                          type="time"
                          value={customTime}
                          onChange={(e) => {
                            const nextTime = e.target.value;
                            setCustomTime(nextTime);
                            setForm({ ...form, schedule: buildCustomSchedule(customDays, nextTime) });
                          }}
                          className="input-field py-2"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-lg flex gap-3 items-start">
                  <ShieldCheck className="text-blue-500 mt-0.5 flex-shrink-0" size={16} />
                  <div>
                    <p className="text-xs text-blue-900 dark:text-blue-300 font-medium">
                      {isUk ? 'Обрано' : 'Selected'}:
                    </p>
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-400 mt-0.5 leading-snug">
                      {scheduleLabel(form.schedule)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 sticky bottom-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur pb-2 -mx-5 px-5 sm:-mx-6 sm:px-6">
                <button type="button" onClick={() => setDialogOpen(false)} className="btn-secondary px-5 py-2">
                  {t('cancel') || 'Cancel'}
                </button>
                <button type="submit" className="btn-primary px-6 py-2">
                  {editing ? (t('save') || 'Save Changes') : (t('create') || 'Create Policy')}
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
