import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Clock, Database, Cloud, Monitor, Gauge, 
  Activity, RefreshCw, Download, RotateCcw
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, Area, AreaChart,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useTranslation } from '../context/LangContext';
import { C, StatCard, PlatformSVG, CustomTooltip } from '../components/DashboardWidgets';
import ActivityFeed from '../components/ActivityFeed';
import { useSocket } from '../context/SocketContext';
import { API } from '../utils/config';

export default function Dashboard() {
  const navigate = useNavigate();
  const { t, lang } = useTranslation();
  const { queueStats } = useSocket();
  const [backups, setBackups] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [dbConnections, setDbConnections] = useState([]);
  const [cloudCreds, setCloudCreds] = useState([]);
  const [vmBackups, setVmBackups] = useState([]);
  const [stats, setStats] = useState(null);

  const loadAll = () => {
    const handleErr = (name) => (e) => console.error(`Failed to load ${name}:`, e);
    fetch(`${API}/api/backups?limit=500`)
      .then(r => r.json())
      .then(data => setBackups(data?.data || (Array.isArray(data) ? data : [])))
      .catch(handleErr('backups'));
    fetch(`${API}/api/schedules`)
      .then(r => r.json())
      .then(data => setSchedules(Array.isArray(data) ? data : []))
      .catch(handleErr('schedules'));
    fetch(`${API}/api/db-connections`)
      .then(r => r.json())
      .then(data => setDbConnections(Array.isArray(data) ? data : []))
      .catch(handleErr('db-connections'));
    fetch(`${API}/api/cloud-credentials`)
      .then(r => r.json())
      .then(data => setCloudCreds(Array.isArray(data) ? data : []))
      .catch(handleErr('cloud-credentials'));
    fetch(`${API}/api/vm-backups`)
      .then(r => r.json())
      .then(data => setVmBackups(Array.isArray(data) ? data : []))
      .catch(handleErr('vm-backups'));
    fetch(`${API}/api/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(handleErr('stats'));
  };
  useEffect(() => { loadAll(); }, []);

  const total = backups.length;
  const completed = backups.filter(b => b.status === 'completed').length;
  const failed = backups.filter(b => b.status === 'failed').length;
  const running = backups.filter(b => b.status === 'running').length;
  const pending = backups.filter(b => b.status === 'pending').length;
  const activeSchedules = schedules.filter(s => s.enabled !== false).length;
  const successRate = total > 0 ? Math.round((completed/total)*100) : 0;

  const { usedGB, storageLimit, storagePercent, isQuota } = useMemo(() => {
    if (stats && stats.diskSpace) {
      const uBytes = stats.diskSpace.usedBytes;
      const tBytes = stats.diskSpace.totalBytes;
      const uGB = Math.round(uBytes / 1073741824 * 10) / 10;
      const tGB = Math.round(tBytes / 1073741824 * 10) / 10;
      const percent = tGB > 0 ? Math.min((uGB / tGB) * 100, 100) : 0;
      return {
        usedGB: uGB,
        storageLimit: tGB,
        storagePercent: percent,
        isQuota: stats.diskSpace.isQuota
      };
    }
    const uBytes = backups.reduce((s,b) => s + (b.size || 0), 0);
    const uGB = Math.round(uBytes / 1073741824 * 10) / 10 || 0;
    const tGB = 50.0;
    const percent = Math.min((uGB / tGB) * 100, 100);
    return {
      usedGB: uGB,
      storageLimit: tGB,
      storagePercent: percent,
      isQuota: false
    };
  }, [stats, backups]);

  const disks = stats?.diskSpace ? [{
    mount: '/',
    totalBytes: stats.diskSpace.totalBytes,
    usedBytes: stats.diskSpace.usedBytes,
    freeBytes: stats.diskSpace.freeBytes,
    totalGB: Math.round(stats.diskSpace.totalBytes / 1073741824 * 10) / 10 || 0,
    usedGB: Math.round(stats.diskSpace.usedBytes / 1073741824 * 10) / 10 || 0,
    freeGB: Math.round(stats.diskSpace.freeBytes / 1073741824 * 10) / 10 || 0,
  }] : [];

  const cloudDisks = [];

  const totalConnections = dbConnections.length + cloudCreds.length + vmBackups.length;
  const avgSpeed = useMemo(() => {
    const withSpeed = backups.filter(b => b.speed);
    return withSpeed.length ? Math.round(withSpeed.reduce((s,b) => s + (b.speed || 0), 0) / withSpeed.length) : 0;
  }, [backups]);

  // Backup size per day
  const sizeChartData = useMemo(() => {
    const byDate = {};
    backups.forEach(b => {
      const day = (b.createdAt || '').slice(0,10);
      if (!day) return;
      if (!byDate[day]) byDate[day] = { date: day, sizeGB: 0, count: 0 };
      byDate[day].sizeGB += (b.size || 0) / 1073741824;
      byDate[day].count += 1;
    });
    return Object.values(byDate).sort((a,b) => a.date.localeCompare(b.date)).map(d => ({ ...d, sizeGB: Math.round(d.sizeGB * 10) / 10 }));
  }, [backups]);

  // Retention
  const retentionDays = 30;
  const oldBackups = backups.filter(b => (new Date(b.createdAt) - new Date()) / 86400000 < -retentionDays).length;

  // Timeline data
  const timelineData = useMemo(() => {
    const byDate = {};
    backups.forEach(b => {
      const day = (b.createdAt || '').slice(0,10);
      if (!day) return;
      if (!byDate[day]) byDate[day] = { date: day, completed:0, failed:0, running:0 };
      if (byDate[day][b.status] !== undefined) byDate[day][b.status]++;
    });
    return Object.values(byDate).sort((a,b) => a.date.localeCompare(b.date));
  }, [backups]);

  // Database type distribution
  const dbDistributionData = useMemo(() => {
    const counts = {};
    backups.forEach(b => {
      const type = b.backupType || b.type || 'unknown';
      const name = type === 'host' ? 'Files' : type.charAt(0).toUpperCase() + type.slice(1);
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [backups]);

  const dbColors = [C.primary, C.secondary, C.success, C.warning, C.error, '#10b981', '#f59e0b', '#3b82f6', '#ec4899'];

  // Status rates
  const statusRateData = useMemo(() => {
    return [
      { name: t('completed') || 'Completed', value: completed, color: C.success },
      { name: t('failed') || 'Failed', value: failed, color: C.error },
      { name: t('running') || 'Running', value: running, color: C.primary },
      { name: t('pending') || 'Pending', value: pending, color: C.warning },
    ].filter(s => s.value > 0);
  }, [completed, failed, running, pending, t]);

  // Connection status
  const connectionStatus = [
    { type: t('databases') || 'Databases', items: dbConnections, icon: <Database size={14} />, color: 'text-emerald-500', bg: 'bg-emerald-500/10', path: '/db-backups' },
    { type: t('cloud') || 'Cloud', items: cloudCreds, icon: <Cloud size={14} />, color: 'text-purple-500', bg: 'bg-purple-500/10', path: '/cloud-backups' },
    { type: t('vms') || 'VMs', items: vmBackups, icon: <Monitor size={14} />, color: 'text-amber-500', bg: 'bg-amber-500/10', path: '/vm-backups' },
  ];

  // Schedules list for bottom section
  const scheduleList = schedules.filter(s => s.enabled !== false).slice(0, 4);
  const recentBackups = backups.slice(0, 5);

  const exportDashboard = () => window.print();

  return (
    <div className="relative w-full max-w-7xl mx-auto min-h-screen pb-12">
      
      {/* Animated background */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden animate-ambient" 
           style={{
             background: 'linear-gradient(-45deg, rgba(56,189,248,0.025), rgba(34,197,94,0.015), rgba(139,92,246,0.018), rgba(245,158,11,0.012))',
             backgroundSize: '400% 400%'
           }} 
      />

      {/* Floating crystals */}
      {[['15%','40%','50','120','6s','0s'], ['40%','80%','35','90','8s','1s'], ['70%','8%','45','100','7s','2s'], ['85%','90%','30','70','5s','1.5s']].map((c,i) => (
        <div key={i} className="absolute z-0 pointer-events-none glass animate-float"
             style={{
               top: c[0], left: c[1], width: c[2]+'px', height: c[3]+'px',
               transform: 'rotate(45deg)', borderRadius: '4px',
               animationDuration: c[4], animationDelay: c[5]
             }} 
        />
      ))}

      <div className="relative z-10 w-full px-4 sm:px-6 lg:px-8 pt-6">
        
        {/* ===== HEADER ===== */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {t('dashboard') || 'Dashboard'}
              </h1>
              
              <div 
                className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border ${successRate >= 80 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'}`}
                title={successRate >= 80 ? 'Healthy' : 'Degraded'}
              >
                <div className={`w-2 h-2 rounded-full animate-pulse ${successRate >= 80 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                {successRate >= 80 ? t('healthy') || 'Healthy' : total > 0 ? t('degraded') || 'Degraded' : t('idle') || 'Idle'}
              </div>
            </div>
            
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {total > 0 
                ? `${successRate}% ${t('success') || 'success'} · ${completed}/${total} · ${activeSchedules} ${t('activeSchedules') || 'active schedules'}` 
                : t('noBackupsConfigured') || 'No backups configured'}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button onClick={loadAll} className="btn-secondary p-2.5 rounded-xl aspect-square flex-shrink-0" title="Refresh">
              <RefreshCw size={18} />
            </button>
            <button onClick={exportDashboard} className="btn-secondary p-2.5 rounded-xl aspect-square flex-shrink-0" title="Export">
              <Download size={18} />
            </button>
            <button onClick={() => navigate('/backups')} className="btn-primary py-2.5 px-6 flex-1 sm:flex-none justify-center">
              {t('viewAll') || 'View All'}
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        {/* ===== ROW 1: STAT CARDS ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-6 lg:mb-8">
          <StatCard 
            label={t('totalJobs') || 'Total Jobs'} 
            value={total} 
            path="/backups" 
            svg={
              <PlatformSVG gradientId="g1" color={C.primary} glowColor={C.primary}>
                <path d="M55,42 a12,12 0 0,1 18,-10 a16,16 0 0,1 24,0 a12,12 0 0,1 0,18 L55,50 Z" fill="url(#g1)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG>
            } 
          />
          <StatCard 
            label={t('completed') || 'Completed'} 
            value={completed} 
            path="/backups" 
            svg={
              <PlatformSVG gradientId="g2" color={C.success} glowColor={C.success}>
                <path d="M55,35 L68,48 L85,22" fill="none" stroke="url(#g2)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG>
            } 
          />
          <StatCard 
            label={t('failed') || 'Failed'} 
            value={failed} 
            path="/backups" 
            svg={
              <PlatformSVG gradientId="g3" color={C.error} glowColor={C.error}>
                <path d="M58,18 L58,42 M58,50 L58,54" fill="none" stroke="url(#g3)" strokeWidth="7" strokeLinecap="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG>
            } 
          />
          <StatCard 
            label={t('activeNow') || 'Active Now'} 
            value={running + pending} 
            path="/backups" 
            svg={
              <PlatformSVG gradientId="g4" color={C.secondary} glowColor={C.secondary}>
                <circle cx="70" cy="36" r="14" fill="none" stroke="url(#g4)" strokeWidth="4" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
                <path d="M70,20 L70,24 M70,36 L70,28 M70,36 L78,36 M80,22 L84,26" stroke="url(#g4)" strokeWidth="3" strokeLinecap="round" />
              </PlatformSVG>
            } 
          />
        </div>

        {/* ===== ROW 2: OVERVIEW + STORAGE ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 mb-6 lg:mb-8">
          
          {/* System Overview (7 cols) */}
          <div className="glass-card flex flex-col p-6 lg:col-span-7">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
              {t('sysOverview') || 'System Overview'}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {/* Sources */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {connectionStatus.map((cs, i) => (
                      <div 
                        key={i} 
                        title={`${cs.type}: ${cs.items.length}`}
                        onClick={() => navigate(cs.path)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ring-2 ring-white dark:ring-slate-900 ${cs.bg} ${cs.color} transition-transform hover:-translate-y-1`}
                      >
                        {cs.icon}
                      </div>
                    ))}
                  </div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {t('sources') || 'Sources'}
                  </span>
                </div>
                <span className="text-3xl font-black text-slate-900 dark:text-white">
                  {totalConnections}
                </span>
              </div>

              {/* Performance */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">
                    <Gauge size={16} />
                  </div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {t('performance') || 'Performance'}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{avgSpeed}</span>
                  <span className="text-sm font-semibold text-slate-500">MB/s</span>
                </div>
              </div>
            </div>

            {/* Disks */}
            {disks.length > 1 && !isQuota && (
              <div className="mt-auto pt-6 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                  {t('disks') || 'Local Disks'}
                </h3>
                <div className="space-y-4">
                  {disks.map((d, i) => {
                    const pct = d.totalGB > 0 ? Math.min((d.usedGB / d.totalGB) * 100, 100) : 0;
                    return (
                      <div key={i}>
                        <div className="flex justify-between items-end mb-1.5">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {d.mount === '/' ? '/ (root)' : d.mount}
                          </span>
                          <span className="text-[10px] font-medium text-slate-500">
                            {d.freeGB.toFixed(1)} GB / {d.totalGB.toFixed(1)} GB free
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-1000 ${pct > 85 ? 'bg-red-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
                            style={{ width: `${pct}%` }} 
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Storage Gauge (5 cols) */}
          <div className="glass-card flex flex-col p-6 lg:col-span-5">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
              {t('storage') || 'Storage Usage'}
            </h2>
            
            <div className="flex-1 flex flex-col items-center justify-center min-h-[220px]">
              <div className="relative mb-8">
                <div 
                  className="w-40 h-40 rounded-full flex items-center justify-center"
                  style={{
                    background: `conic-gradient(${C.primary} ${storagePercent}%, rgba(148,163,184,0.1) ${storagePercent}%)`,
                  }}
                >
                  <div className="w-32 h-32 rounded-full bg-white dark:bg-slate-900 shadow-inner flex flex-col items-center justify-center">
                    <span className="text-3xl font-black text-slate-900 dark:text-white leading-none mb-1">
                      {Math.round(storagePercent)}%
                    </span>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                      {t('used') || 'Used'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="w-full space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    {t('used') || 'Used Space'}
                  </span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {usedGB.toFixed(1)} GB
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-1000"
                    style={{ width: `${storagePercent}%` }} 
                  />
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-[11px] font-medium text-slate-500">
                    {t('ofTotal', { total: storageLimit.toFixed(1) }) || `of ${storageLimit.toFixed(1)} GB total`}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isQuota ? 'bg-purple-500/10 text-purple-600 border-purple-500/20' : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'}`}>
                    {isQuota ? (t('storageQuotaLimit') || 'Quota Limit') : (t('storageRealDisk') || 'Physical Disk')}
                  </span>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* ===== CLOUD STORAGE ===== */}
        {cloudDisks.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 mb-6 lg:mb-8">
            {cloudDisks.map(c => {
              const usedGB = c.usedGB;
              const isAws = c.provider === 'aws';
              const isGcp = c.provider === 'gcp';
              
              let colors = 'bg-blue-500/10 text-blue-600 border-blue-500/20';
              if (isAws) colors = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
              if (isGcp) colors = 'bg-red-500/10 text-red-600 border-red-500/20';
              
              return (
                <div key={c.id} className="glass-card p-5 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{c.name}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${colors}`}>
                      {c.provider}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-3xl font-black text-slate-900 dark:text-white">{usedGB.toFixed(1)}</span>
                    <span className="text-xs font-semibold text-slate-500">GB {t('used') || 'used'}</span>
                  </div>
                  {c.error && <p className="text-[10px] font-medium text-red-500 mt-2">{c.error}</p>}
                </div>
              );
            })}
          </div>
        )}

        {/* ===== ROW 3: CHARTS ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 mb-6 lg:mb-8">
          
          {/* Daily Backup Size */}
          <div className="glass-card p-6 flex flex-col min-h-[350px]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
              {t('dailyBackupSize') || 'Daily Backup Size'}
            </h2>
            <p className="text-xs font-medium text-slate-500 mb-6 uppercase tracking-wider">Gigabytes (GB)</p>
            
            <div className="flex-1 w-full relative">
              {sizeChartData.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                  <BarChart width={200} height={100} data={[{date:'—', sizeGB:0}]}>
                    <Bar dataKey="sizeGB" fill="rgba(148,163,184,0.1)" radius={[4,4,0,0]} />
                  </BarChart>
                  <p className="text-sm font-medium mt-4">{t('noDataYet') || 'No data available yet'}</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sizeChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={v=>v.slice(5)} tick={{fontSize:11, fill:'#94a3b8'}} axisLine={false} tickLine={false} dy={10} />
                    <YAxis tick={{fontSize:11, fill:'#94a3b8'}} axisLine={false} tickLine={false} dx={-10} />
                    <ReTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148,163,184,0.05)' }} />
                    <Bar dataKey="sizeGB" fill="url(#barGrad)" radius={[4,4,0,0]} maxBarSize={40} />
                    <defs>
                      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.primary} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={C.secondary} stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Backup Timeline */}
          <div className="glass-card p-6 flex flex-col min-h-[350px]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
              {t('backupTimeline') || 'Backup Timeline'}
            </h2>
            <p className="text-xs font-medium text-slate-500 mb-6 uppercase tracking-wider">Number of Jobs</p>
            
            <div className="flex-1 w-full relative">
              {timelineData.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                  <Activity size={48} className="opacity-20 mb-4" />
                  <p className="text-sm font-medium">{t('noDataYet') || 'No data available yet'}</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.success} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.success} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={v=>v.slice(5)} tick={{fontSize:11, fill:'#94a3b8'}} axisLine={false} tickLine={false} dy={10} />
                    <YAxis tick={{fontSize:11, fill:'#94a3b8'}} axisLine={false} tickLine={false} dx={-10} />
                    <ReTooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="completed" stroke={C.success} fill="url(#areaGrad)" strokeWidth={3} name={t('completed') || 'Completed'} />
                    {timelineData.some(d => d.failed > 0) && (
                      <Area type="monotone" dataKey="failed" stroke={C.error} fill="none" strokeWidth={2} strokeDasharray="4 4" name={t('failed') || 'Failed'} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

        </div>

        {/* ===== ROW 3.5: PIE CHARTS ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 mb-6 lg:mb-8">
          
          {/* Backup Distribution */}
          <div className="glass-card p-6 flex flex-col min-h-[350px]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
              {t('backupDistribution') || 'Backup Distribution'}
            </h2>
            <p className="text-xs font-medium text-slate-500 mb-6 uppercase tracking-wider">
              {t('byEngineType') || 'By target type'}
            </p>
            
            <div className="flex-1 w-full relative">
              {dbDistributionData.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                  <p className="text-sm font-medium">{t('noDataYet') || 'No data available yet'}</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dbDistributionData}
                      cx="50%"
                      cy="45%"
                      innerRadius={70}
                      outerRadius={95}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {dbDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={dbColors[index % dbColors.length]} />
                      ))}
                    </Pie>
                    <ReTooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 12, fontWeight: 500 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Status Rate */}
          <div className="glass-card p-6 flex flex-col min-h-[350px]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
              {t('statusDistribution') || 'Status Rate'}
            </h2>
            <p className="text-xs font-medium text-slate-500 mb-6 uppercase tracking-wider">
              {t('byStatusType') || 'By job status'}
            </p>
            
            <div className="flex-1 w-full relative">
              {statusRateData.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                  <p className="text-sm font-medium">{t('noDataYet') || 'No data available yet'}</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusRateData}
                      cx="50%"
                      cy="45%"
                      innerRadius={70}
                      outerRadius={95}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {statusRateData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <ReTooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 12, fontWeight: 500 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

        </div>

        {/* ===== ROW 4: ACTIVITY + BACKUPS + ACTIONS ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 mb-6 lg:mb-8">
          
          {/* Recent Activity */}
          <div className="glass-card p-6 flex flex-col min-h-[400px]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {t('recentActivity') || 'Recent Activity'}
              </h2>
              {queueStats?.running > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                  {queueStats.running} Active
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <ActivityFeed />
            </div>
          </div>

          {/* Recent Backups */}
          <div className="glass-card p-6 flex flex-col min-h-[400px]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {t('recentBackups') || 'Recent Backups'}
              </h2>
              <span className="text-xs font-semibold text-slate-500">
                {total} {t('totalJobs') || 'total'}
              </span>
            </div>
            
            <div className="flex-1 flex flex-col">
              {recentBackups.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                  <Database size={40} className="opacity-20 mb-4" />
                  <p className="text-sm font-medium mb-6">{t('noBackupsYet') || 'No backups yet'}</p>
                  <button 
                    onClick={() => navigate('/backups')} 
                    className="btn-primary w-full max-w-[200px]"
                  >
                    {t('createFirstBackup') || 'Create Backup'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentBackups.map(b => (
                    <div 
                      key={b.id} 
                      onClick={() => navigate('/backups')}
                      className="group flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700/50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 shadow-sm ${
                          b.status === 'completed' ? 'bg-emerald-500 shadow-emerald-500/50' : 
                          b.status === 'failed' ? 'bg-red-500 shadow-red-500/50' : 
                          b.status === 'running' ? 'bg-blue-500 shadow-blue-500/50 animate-pulse' : 
                          'bg-amber-500 shadow-amber-500/50'
                        }`} />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            {b.name}
                          </p>
                          <p className="text-[11px] font-medium text-slate-500 truncate mt-0.5">
                            {(b.createdAt || '').slice(0,16).replace('T', ' ')}
                          </p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0 ml-3 ${
                        b.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 
                        b.status === 'failed' ? 'bg-red-500/10 text-red-600 border-red-500/20' : 
                        b.status === 'running' ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' : 
                        'bg-amber-500/10 text-amber-600 border-amber-500/20'
                      }`}>
                        {b.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="glass-card p-6 flex flex-col min-h-[400px]">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
              {t('quickActions') || 'Quick Actions'}
            </h2>
            <div className="flex-1 flex flex-col justify-center gap-3">
              {[
                { label: t('newBackupBtn') || 'New Backup', path: '/backups', icon: <Database size={18} />, color: 'from-blue-500 to-indigo-500', shadow: 'shadow-blue-500/25' },
                { label: t('restore') || 'Restore Data', path: '/restore', icon: <RotateCcw size={18} />, color: 'from-indigo-500 to-purple-500', shadow: 'shadow-indigo-500/25' },
                { label: t('manageSchedulesBtn') || 'Manage Schedules', path: '/schedules', icon: <Clock size={18} />, color: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-500/25' },
                { label: t('exportDashboardBtn') || 'Export Report', path: '#export', action: exportDashboard, icon: <Download size={18} />, color: 'from-emerald-500 to-teal-500', shadow: 'shadow-emerald-500/25' },
              ].map(act => (
                <button
                  key={act.label}
                  onClick={act.action || (() => navigate(act.path))}
                  className="w-full relative group overflow-hidden rounded-xl p-4 flex items-center gap-4 transition-all duration-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-transparent"
                >
                  <div className={`absolute inset-0 bg-gradient-to-r ${act.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                  <div className={`relative z-10 w-10 h-10 rounded-lg bg-white dark:bg-slate-900 shadow-sm flex items-center justify-center text-slate-700 dark:text-slate-300 group-hover:text-white group-hover:bg-transparent group-hover:shadow-none transition-all duration-300`}>
                    {act.icon}
                  </div>
                  <span className="relative z-10 text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-white transition-colors">
                    {act.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* ===== ROW 5: ACTIVE SCHEDULES ===== */}
        <div className="glass-card p-6 mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {t('activeSchedules') || 'Active Schedules'}
            </h2>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 text-xs font-bold rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                {activeSchedules} {t('active') || 'active'}
              </span>
              <button 
                onClick={() => navigate('/schedules')} 
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                {t('actions') || 'Manage'} <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {scheduleList.length === 0 ? (
            <div className="flex items-center gap-3 py-6 text-slate-500">
              <Clock size={24} className="opacity-20" />
              <p className="text-sm font-medium">{t('noActiveSchedules') || 'No active schedules found'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {scheduleList.map(s => (
                <div key={s.id} className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 hover:bg-white dark:hover:bg-slate-800 hover:shadow-lg hover:shadow-slate-200/50 dark:hover:shadow-none hover:border-slate-200 dark:hover:border-slate-600 transition-all duration-300 flex flex-col justify-between group">
                  <div className="mb-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {s.name}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-900/50 px-2 py-1 rounded inline-block">
                      {s.cronExpression || s.cron || '—'}
                    </p>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-slate-200/50 dark:border-slate-700/50">
                    <p className="text-xs font-medium text-slate-500">
                      {t('nextRun') || 'Next Run'}: <span className="text-slate-700 dark:text-slate-300 font-semibold">{s.nextRun ? s.nextRun.slice(0,10) : '—'}</span>
                    </p>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 py-4 border-t border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500">
          <p>
            {t('retentionInfo', { days: retentionDays, total, expiring: oldBackups }) || 
              `${retentionDays}-day retention policy applies. ${total} total backups, ${oldBackups} expiring soon.`}
          </p>
          <p>
            {t('lastUpdated') || 'Last updated'}: {new Date().toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US')}
          </p>
        </div>

      </div>
    </div>
  );
}
