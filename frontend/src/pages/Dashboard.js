import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, Chip, Button, Stack, Tooltip, alpha,
} from '@mui/material';
import {
  ArrowForward as ArrowIcon, Schedule as ScheduleIcon, Backup as BackupIcon,
  CloudQueue as CloudIcon, Computer as ComputerIcon,
  Storage as DatabaseIcon, Speed as SpeedIcon, Timeline as TimelineIcon,
  Refresh as RefreshIcon, Download as DownloadIcon,
  Restore as RestoreIcon,
} from '@mui/icons-material';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, Area, AreaChart,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useTranslation } from '../context/LangContext';
import { C, GLASS, StatCard, PlatformSVG, CustomTooltip } from '../components/DashboardWidgets';
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
    fetch(`${API}/api/backups`).then(r=>r.json()).then(setBackups).catch(handleErr('backups'));
    fetch(`${API}/api/schedules`).then(r=>r.json()).then(setSchedules).catch(handleErr('schedules'));
    fetch(`${API}/api/db-connections`).then(r=>r.json()).then(setDbConnections).catch(handleErr('db-connections'));
    fetch(`${API}/api/cloud-credentials`).then(r=>r.json()).then(setCloudCreds).catch(handleErr('cloud-credentials'));
    fetch(`${API}/api/vm-backups`).then(r=>r.json()).then(setVmBackups).catch(handleErr('vm-backups'));
    fetch(`${API}/api/stats`).then(r=>r.json()).then(setStats).catch(handleErr('stats'));
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

  const disks = (stats?.diskSpaces || []).map(d => {
    const tGB = Math.round(d.totalBytes / 1073741824 * 10) / 10 || 0;
    const uGB = Math.round(d.usedBytes / 1073741824 * 10) / 10 || 0;
    const fGB = Math.round(d.freeBytes / 1073741824 * 10) / 10 || 0;
    return { ...d, totalGB: tGB, usedGB: uGB, freeGB: fGB };
  });

  const cloudDisks = (stats?.cloudSpaces || []).map(c => {
    const usedGB = Math.round(c.usedBytes / 1073741824 * 10) / 10 || 0;
    return { ...c, usedGB };
  });

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
      { name: t('completed'), value: completed, color: C.success },
      { name: t('failed'), value: failed, color: C.error },
      { name: t('running'), value: running, color: C.primary },
      { name: t('pending'), value: pending, color: C.warning },
    ].filter(s => s.value > 0);
  }, [completed, failed, running, pending, t]);

  // Connection status
  const connectionStatus = [
    { type: t('databases'), items: dbConnections, icon: <DatabaseIcon />, color: C.success, path: '/db-backups' },
    { type: t('cloud'), items: cloudCreds, icon: <CloudIcon />, color: C.secondary, path: '/cloud-backups' },
    { type: t('vms'), items: vmBackups, icon: <ComputerIcon />, color: C.warning, path: '/vm-backups' },
  ];

  // Schedules list for bottom section
  const scheduleList = schedules.filter(s => s.enabled !== false).slice(0, 4);
  const recentBackups = backups.slice(0, 5);

  const exportDashboard = () => {
    window.print();
  };

  /* ── shared row style: uses CSS Grid with equal-height columns ── */
  const gridRow = {
    display: 'grid',
    gap: { xs: 2.25, lg: 3 },
    mb: { xs: 2.75, lg: 3 },
    alignItems: 'stretch',
    gridAutoRows: '1fr',
    minWidth: 0,
  };

  return (
    <>
      <style>{`
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes ambient { 0%{backgroundPosition:0% 50%} 50%{backgroundPosition:100% 50%} 100%{backgroundPosition:0% 50%} }
        .floating { animation: float 5s ease-in-out infinite; }
        .platform-shadow { filter: drop-shadow(0 10px 12px rgba(2,6,23,0.45)); max-width: 100%; height: auto; }
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
        .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
        @media print { body { background: #0b1120 !important; } }
      `}</style>

      {/* Animated background */}
      <Box sx={{
        position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:0, pointerEvents:'none', overflow:'hidden',
        background:'linear-gradient(-45deg, rgba(56,189,248,0.035), rgba(34,197,94,0.025), rgba(139,92,246,0.028), rgba(245,158,11,0.018))',
        backgroundSize:'400% 400%', animation:'ambient 15s ease infinite',
      }} />

      {/* Floating crystals */}
      {[['15%','40%','50','120','6s','0s'], ['40%','80%','35','90','8s','1s'], ['70%','8%','45','100','7s','2s'], ['85%','90%','30','70','5s','1.5s']].map((c,i) => (
        <Box key={i} sx={{
          position:'absolute', width:c[2]+'px', height:c[3]+'px', top:c[0], left:c[1], zIndex:0, pointerEvents:'none',
          background:'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))',
          backdropFilter:'blur(4px)', border:'1px solid rgba(255,255,255,0.03)', transform:'rotate(45deg)',
          borderRadius:'4px', animation:`float ${c[4]} ease-in-out infinite ${c[5]}`,
        }} />
      ))}

      <Box sx={{ position:'relative', zIndex:1, width: '100%', maxWidth:1440, mx:'auto', px:{ xs: 0, sm: 1 }, minWidth: 0 }}>
        {/* ===== HEADER ===== */}
        <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', mb:3, flexWrap:'wrap', gap:2 }}>
          <Box>
            <Box sx={{ display:'flex', alignItems:'center', gap:1.5, mb:0.5 }}>
              <Typography variant="h4" sx={{ fontWeight:800, letterSpacing:'-0.5px', color:'#fff' }}>{t('dashboard')}</Typography>
              <Tooltip title={`${successRate >= 80 ? t('healthy') : t('degraded')}`}>
                <Box sx={{ display:'flex', alignItems:'center', gap:0.5, px:1.5, py:0.3, borderRadius:'20px', bgcolor:alpha(successRate >= 80 ? C.success : C.warning, 0.12) }}>
                  <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:successRate >= 80 ? C.success : C.warning, boxShadow:`0 0 8px ${successRate >= 80 ? C.success : C.warning}`, className:'pulse-dot' }} />
                  <Typography variant="caption" sx={{ color:successRate >= 80 ? C.success : C.warning, fontWeight:600, fontSize:11 }}>
                    {successRate >= 80 ? t('healthy') : total > 0 ? t('degraded') : t('idle')}
                  </Typography>
                </Box>
              </Tooltip>
            </Box>
            <Typography variant="body2" sx={{ color:'text.secondary', fontSize:13, fontWeight:500 }}>
              {total > 0 ? `${successRate}% ${t('success').toLowerCase()} · ${completed}/${total} · ${activeSchedules} ${t('activeSchedules').toLowerCase()}` : t('noBackupsConfigured')}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: { xs: 'stretch', sm: 'flex-end' }, width: { xs: '100%', sm: 'auto' } }}>
            <Button onClick={loadAll} sx={{
              borderRadius:'30px', px:2.5, py:1, fontSize:12, fontWeight:600, textTransform:'none', minWidth:0,
              bgcolor:'rgba(255,255,255,0.03)', color:'rgba(255,255,255,0.6)', border:`1px solid ${C.border}`,
              flex: { xs: '1 1 44px', sm: '0 0 auto' }, '&:hover':{bgcolor:'rgba(255,255,255,0.08)'},
            }}><RefreshIcon sx={{ fontSize:16 }} /></Button>
            <Button onClick={exportDashboard} sx={{
              borderRadius:'30px', px:2.5, py:1, fontSize:12, fontWeight:600, textTransform:'none', minWidth:0,
              bgcolor:'rgba(255,255,255,0.03)', color:'rgba(255,255,255,0.6)', border:`1px solid ${C.border}`,
              flex: { xs: '1 1 44px', sm: '0 0 auto' }, '&:hover':{bgcolor:'rgba(255,255,255,0.08)'},
            }}><DownloadIcon sx={{ fontSize:16 }} /></Button>
            <Button onClick={() => navigate('/backups')} sx={{
              borderRadius:'30px', px:3, py:1, fontSize:13, fontWeight:600, textTransform:'none',
              bgcolor:'rgba(255,255,255,0.03)', color:'rgba(255,255,255,0.8)', border:`1px solid ${C.border}`,
              flex: { xs: '1 1 100%', sm: '0 0 auto' }, '&:hover':{bgcolor:'rgba(255,255,255,0.08)', borderColor:'rgba(255,255,255,0.2)'},
            }} endIcon={<ArrowIcon fontSize="small" />}>{t('viewAll')}</Button>
          </Stack>
        </Box>

        {/* ===== ROW 1: 4 STAT CARDS — EQUAL WIDTH ===== */}
        <Box sx={{ ...gridRow, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' } }}>
          {[
            { label: t('totalJobs'), value:total, color: C.primary, path:'/backups', svg:
              <PlatformSVG gradientId="g1" color={C.primary} glowColor={C.primary}>
                <path d="M55,42 a12,12 0 0,1 18,-10 a16,16 0 0,1 24,0 a12,12 0 0,1 0,18 L55,50 Z" fill="url(#g1)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG> },
            { label: t('completed'), value:completed, color:C.success, path:'/backups', svg:
              <PlatformSVG gradientId="g2" color={C.success} glowColor={C.success}>
                <path d="M55,35 L68,48 L85,22" fill="none" stroke="url(#g2)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG> },
            { label: t('failed'), value:failed, color:C.error, path:'/backups', svg:
              <PlatformSVG gradientId="g3" color={C.error} glowColor={C.error}>
                <path d="M58,18 L58,42 M58,50 L58,54" fill="none" stroke="url(#g3)" strokeWidth="7" strokeLinecap="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG> },
            { label: t('activeNow'), value:running + pending, color:C.secondary, path:'/backups', svg:
              <PlatformSVG gradientId="g4" color={C.secondary} glowColor={C.secondary}>
                <circle cx="70" cy="36" r="14" fill="none" stroke="url(#g4)" strokeWidth="4" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
                <path d="M70,20 L70,24 M70,36 L70,28 M70,36 L78,36 M80,22 L84,26" stroke="url(#g4)" strokeWidth="3" strokeLinecap="round" />
              </PlatformSVG> },
          ].map((item,i) => (
            <StatCard key={i} {...item} />
          ))}
        </Box>

        {/* ===== ROW 2: OVERVIEW (7fr) + STORAGE (5fr) — EQUAL HEIGHT ===== */}
        <Box sx={{ ...gridRow, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 7fr) minmax(280px, 5fr)' } }}>
          {/* System Overview */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, display: 'flex', flexDirection: 'column', flex:1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2.5, color:'#fff' }}>{t('sysOverview')}</Typography>

              {/* Sources + Performance row */}
              <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr', sm:'repeat(2, minmax(0, 1fr))' }, gap:2, mb:3 }}>
                {/* Sources Indicator */}
                <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', p:2, borderRadius:2, bgcolor:'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', gap: 1.5 }}>
                  <Box sx={{ display:'flex', alignItems:'center', gap:1.5, minWidth: 0 }}>
                    <Box sx={{ display:'flex', gap:0.5, flexShrink: 0 }}>
                      {connectionStatus.map((cs,i) => (
                        <Tooltip key={i} title={`${cs.type}: ${cs.items.length}`}>
                          <Box sx={{ cursor:'pointer', width:30, height:30, borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', bgcolor:alpha(cs.color, 0.12), color:cs.color, fontSize:14 }} onClick={() => navigate(cs.path)}>
                            {cs.icon}
                          </Box>
                        </Tooltip>
                      ))}
                    </Box>
                    <Typography variant="body2" noWrap sx={{ color:'text.primary', fontWeight:600, fontSize:13 }}>{t('sources')}</Typography>
                  </Box>
                  <Typography variant="h5" sx={{ fontWeight:800, color:'#fff', fontSize:22, flexShrink: 0 }}>{totalConnections}</Typography>
                </Box>

                {/* Performance */}
                <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', p:2, borderRadius:2, bgcolor:'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', gap: 1.5 }}>
                  <Box sx={{ display:'flex', alignItems:'center', gap:1, minWidth: 0 }}>
                    <SpeedIcon sx={{ color: C.secondary, fontSize: 20, flexShrink: 0 }} />
                    <Typography variant="body2" noWrap sx={{ color:'text.primary', fontWeight:600, fontSize:13 }}>{t('performance')}</Typography>
                  </Box>
                  <Typography variant="h5" sx={{ fontWeight:800, color:'#fff', fontSize:22, flexShrink: 0 }}>{avgSpeed} <span style={{ fontSize:12, fontWeight:500, color:alpha('#fff', 0.5) }}>MB/s</span></Typography>
                </Box>
              </Box>

              {disks.length > 1 && !isQuota && (
                <Box sx={{ mt: 2.5, pt: 2, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <Typography variant="caption" sx={{ color: alpha('#fff',0.4), fontWeight:600, fontSize:10, textTransform:'uppercase', letterSpacing:1, mb:1.5, display:'block' }}>{t('disks')}</Typography>
                  <Stack spacing={1.2}>
                    {disks.map((d, i) => {
                      const pct = d.totalGB > 0 ? Math.min((d.usedGB / d.totalGB) * 100, 100) : 0;
                      return (
                        <Box key={i}>
                          <Box sx={{ display:'flex', justifyContent:'space-between', mb:0.3 }}>
                            <Typography variant="caption" sx={{ color: alpha('#fff',0.7), fontWeight:500, fontSize:11 }}>
                              {d.mount === '/' ? '/ (root)' : d.mount}
                            </Typography>
                            <Typography variant="caption" sx={{ color: alpha('#fff',0.4), fontSize:10 }}>
                              {d.freeGB.toFixed(1)} GB / {d.totalGB.toFixed(1)} GB
                            </Typography>
                          </Box>
                          <Box sx={{ height:4, borderRadius:3, bgcolor:'rgba(255,255,255,0.04)', overflow:'hidden' }}>
                            <Box sx={{ height:'100%', borderRadius:3, width:`${pct}%`, background:`linear-gradient(90deg, ${pct > 85 ? C.error : C.primary}, ${pct > 85 ? C.error : C.secondary})` }} />
                          </Box>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Storage Gauge */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, display: 'flex', flexDirection: 'column', flex:1, justifyContent: 'space-between' }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2, color:'#fff' }}>{t('storage')}</Typography>

              <Box sx={{ display:'flex', flexDirection: 'column', alignItems:'center', justifyContent:'center', flex:1 }}>
                <Box sx={{ position:'relative', flexShrink:0, mb: 3 }}>
                  <Box sx={{ width:140, height:140, borderRadius:'50%',
                    background: `conic-gradient(${C.primary} ${storagePercent}%, rgba(255,255,255,0.03) ${storagePercent}%)`,
                    border:'4px solid rgba(255,255,255,0.02)', display:'flex', alignItems:'center', justifyContent:'center',
                  }}>
                    <Box sx={{ width:112, height:112, borderRadius:'50%', background:'linear-gradient(135deg, rgba(20,25,40,0.85), rgba(15,20,35,0.75))',
                      border:`1px solid ${C.border}`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                      boxShadow:'inset 0 4px 12px rgba(0,0,0,0.4)' }}>
                      <Typography variant="h4" sx={{ fontWeight:800, lineHeight:1.1, fontSize:28, color:'#fff' }}>{Math.round(storagePercent)}%</Typography>
                      <Typography variant="caption" sx={{ color:'text.secondary', fontSize:11, fontWeight:500 }}>{t('used')}</Typography>
                    </Box>
                  </Box>
                </Box>
              </Box>

              <Box>
                <Box sx={{ display:'flex', justifyContent:'space-between', mb:0.5 }}>
                  <Typography variant="caption" sx={{ color:'text.secondary' }}>{t('used')}</Typography>
                  <Typography variant="caption" sx={{ fontWeight:600, color:'#fff' }}>{usedGB.toFixed(1)} GB</Typography>
                </Box>
                <Box sx={{ height:6, borderRadius:3, bgcolor:'rgba(255,255,255,0.05)', overflow:'hidden', mb:1 }}>
                  <Box sx={{ height:'100%', borderRadius:3, width:`${storagePercent}%`, background:`linear-gradient(90deg, ${C.primary}, ${C.secondary})`, transition:'width 1s' }} />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="caption" sx={{ color:alpha('#fff',0.3), fontSize:11 }}>
                    {t('ofTotal', { total: storageLimit.toFixed(1) })}
                  </Typography>
                  <Chip
                    label={isQuota ? t('storageQuotaLimit') : t('storageRealDisk')}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: 9,
                      fontWeight: 600,
                      bgcolor: isQuota ? 'rgba(124, 58, 237, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: isQuota ? C.primary : C.success,
                      border: '1px solid',
                      borderColor: isQuota ? 'rgba(124, 58, 237, 0.3)' : 'rgba(16, 185, 129, 0.3)'
                    }}
                  />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* ===== CLOUD STORAGE ===== */}
        {cloudDisks.length > 0 && (
          <Box sx={{ ...gridRow, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
            {cloudDisks.map(c => {
              const usedGB = c.usedGB;
              const colorMap = { aws: '#ff9900', azure: '#0078d4', gcp: '#4285f4' };
              const color = colorMap[c.provider] || C.primary;
              return (
                <Card key={c.id} sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
                  <CardContent sx={{ p:3 }}>
                    <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:2 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight:700, color:'#fff', fontSize:14 }}>{c.name}</Typography>
                      <Chip label={c.provider.toUpperCase()} size="small" sx={{ height:18, fontSize:9, fontWeight:600, bgcolor:alpha(color,0.15), color, border:`1px solid ${alpha(color,0.3)}` }} />
                    </Box>
                    <Box sx={{ display:'flex', alignItems:'baseline', gap:0.5, mb:0.5 }}>
                      <Typography variant="h5" sx={{ fontWeight:800, color:'#fff', fontSize:22 }}>{usedGB.toFixed(1)}</Typography>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.4), fontSize:12 }}>GB {t('used')}</Typography>
                    </Box>
                    {c.error && <Typography variant="caption" sx={{ color:C.error, fontSize:10, mt:0.5, display:'block' }}>{c.error}</Typography>}
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        )}

        {/* ===== ROW 3: 2 CHARTS — 50/50 ===== */}
        <Box sx={{ ...gridRow, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } }}>
          {/* Daily Backup Size */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, flex:1, display:'flex', flexDirection:'column' }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, mb:0.3, color:'#fff' }}>{t('dailyBackupSize')}</Typography>
              <Typography variant="caption" sx={{ color:alpha('#fff',0.3), display:'block', mb:2.5, fontSize:11 }}>GB</Typography>
              {sizeChartData.length === 0 ? (
                <Box sx={{ py:6, textAlign:'center', flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                  <BarChart width={300} height={160} data={[{date:'—', sizeGB:0}]}>
                    <Bar dataKey="sizeGB" fill="rgba(255,255,255,0.03)" radius={[4,4,0,0]} />
                  </BarChart>
                  <Typography variant="body2" sx={{ color:alpha('#fff',0.3), mt:2, fontSize:13 }}>{t('noDataYet')}</Typography>
                </Box>
              ) : (
                <Box sx={{ width:'100%', flex:1, minHeight:200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sizeChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="date" tickFormatter={v=>v.slice(5)} tick={{fontSize:10, fill:alpha('#fff',0.5)}} axisLine={false} tickLine={false} stroke="rgba(255,255,255,0.1)" />
                      <YAxis tick={{fontSize:10, fill:alpha('#fff',0.5)}} axisLine={false} tickLine={false} stroke="rgba(255,255,255,0.1)" />
                      <ReTooltip content={<CustomTooltip />} />
                      <Bar dataKey="sizeGB" fill="url(#barGrad)" radius={[4,4,0,0]} maxBarSize={30} />
                      <defs>
                        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.primary} stopOpacity={0.8} />
                          <stop offset="100%" stopColor={C.secondary} stopOpacity={0.2} />
                        </linearGradient>
                      </defs>
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Backup Timeline */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, flex:1, display:'flex', flexDirection:'column' }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, mb:0.3, color:'#fff' }}>{t('backupTimeline')}</Typography>
              <Typography variant="caption" sx={{ color:alpha('#fff',0.3), display:'block', mb:2.5, fontSize:11 }}>{t('dailyBackupSize').toLowerCase()}</Typography>
              {timelineData.length === 0 ? (
                <Box sx={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', py:4 }}>
                  <TimelineIcon sx={{ color:alpha('#fff',0.06), fontSize:48, mb:2 }} />
                  <Typography variant="body2" sx={{ color:alpha('#fff',0.3), fontSize:13 }}>{t('noDataYet')}</Typography>
                </Box>
              ) : (
                <Box sx={{ width:'100%', flex:1, minHeight:200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData}>
                      <defs>
                        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.success} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={C.success} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="date" tickFormatter={v=>v.slice(5)} tick={{fontSize:10, fill:alpha('#fff',0.5)}} axisLine={false} tickLine={false} stroke="rgba(255,255,255,0.1)" />
                      <YAxis tick={{fontSize:10, fill:alpha('#fff',0.5)}} axisLine={false} tickLine={false} stroke="rgba(255,255,255,0.1)" />
                      <ReTooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="completed" stroke={C.success} fill="url(#areaGrad)" strokeWidth={2} name={t('completed')} />
                      {timelineData.some(d => d.failed > 0) && <Area type="monotone" dataKey="failed" stroke={C.error} fill="none" strokeWidth={1.5} strokeDasharray="4 4" name={t('failed')} />}
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>

        {/* ===== ROW 3.5: PIE CHARTS — 50/50 ===== */}
        <Box sx={{ ...gridRow, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } }}>
          {/* Backup Type Distribution */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, flex:1, display:'flex', flexDirection:'column' }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, mb:0.5, color:'#fff' }}>{t('backupDistribution') || 'Backup Distribution'}</Typography>
              <Typography variant="caption" sx={{ color:alpha('#fff',0.3), display:'block', mb:2.5, fontSize:11 }}>{t('byEngineType') || 'By target type'}</Typography>
              {dbDistributionData.length === 0 ? (
                <Box sx={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', py:4 }}>
                  <Typography variant="body2" sx={{ color:alpha('#fff',0.3), fontSize:13 }}>{t('noDataYet')}</Typography>
                </Box>
              ) : (
                <Box sx={{ width:'100%', flex:1, minHeight:220, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={dbDistributionData}
                        cx="50%"
                        cy="45%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {dbDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={dbColors[index % dbColors.length]} />
                        ))}
                      </Pie>
                      <ReTooltip />
                      <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11, color: '#fff' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Backup Status Distribution */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, flex:1, display:'flex', flexDirection:'column' }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, mb:0.5, color:'#fff' }}>{t('statusDistribution') || 'Status Rate'}</Typography>
              <Typography variant="caption" sx={{ color:alpha('#fff',0.3), display:'block', mb:2.5, fontSize:11 }}>{t('byStatusType') || 'By job status'}</Typography>
              {statusRateData.length === 0 ? (
                <Box sx={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', py:4 }}>
                  <Typography variant="body2" sx={{ color:alpha('#fff',0.3), fontSize:13 }}>{t('noDataYet')}</Typography>
                </Box>
              ) : (
                <Box sx={{ width:'100%', flex:1, minHeight:220, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusRateData}
                        cx="50%"
                        cy="45%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {statusRateData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <ReTooltip />
                      <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>

        {/* ===== ROW 4: ACTIVITY + BACKUPS + ACTIONS — EQUAL 33% ===== */}
        <Box sx={{ ...gridRow, gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' } }}>
          {/* Recent Activity */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, display: 'flex', flexDirection: 'column', flex:1 }}>
              <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:2.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, color:'#fff' }}>{t('recentActivity')}</Typography>
                {queueStats.active > 0 && (
                  <Chip 
                    label={`${queueStats.active} active`} 
                    size="small" 
                    sx={{ bgcolor: alpha(C.secondary, 0.15), color: C.secondary, fontWeight: 700, fontSize: 10, height: 18 }} 
                  />
                )}
              </Box>
              <ActivityFeed />
            </CardContent>
          </Card>

          {/* Recent Backups */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, display: 'flex', flexDirection: 'column', flex:1 }}>
              <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:2.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, color:'#fff' }}>{t('recentBackups')}</Typography>
                <Chip label={`${total} ${t('totalJobs').toLowerCase()}`} size="small" sx={{ bgcolor:'rgba(255,255,255,0.04)', color:alpha('#fff',0.4), fontWeight:600, fontSize:10 }} />
              </Box>
              {recentBackups.length === 0 ? (
                <Box sx={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', py:2 }}>
                  <BackupIcon sx={{ color:alpha('#fff',0.06), fontSize:40, mb:1.5 }} />
                  <Typography variant="body2" sx={{ color:alpha('#fff',0.35), mb:2, fontSize:13 }}>{t('noBackupsYet')}</Typography>
                  <Button fullWidth onClick={() => navigate('/backups')} sx={{
                    borderRadius:'12px', py:1.2, textTransform:'none', fontWeight:700, fontSize:12,
                    background:`linear-gradient(90deg, ${C.primary}, #3b82f6)`, color:'#fff',
                    boxShadow:'0 4px 16px rgba(124,58,237,0.2)',
                    '&:hover':{background:`linear-gradient(90deg, #6d28d9, #2563eb)`},
                  }}>{t('createFirstBackup')}</Button>
                </Box>
              ) : (
                <Stack spacing={1} sx={{ flex:1 }}>
                  {recentBackups.map((b) => (
                    <Box key={b.id} sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', py:1, px:1, borderRadius:1.5, '&:hover':{bgcolor:'rgba(255,255,255,0.02)'}, cursor:'pointer' }} onClick={() => navigate('/backups')}>
                      <Box sx={{ display:'flex', alignItems:'center', gap:1.5, minWidth:0, flex:1 }}>
                        <Box sx={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
                          bgcolor: b.status === 'completed' ? C.success : b.status === 'failed' ? C.error : b.status === 'running' ? C.secondary : C.warning,
                          boxShadow: `0 0 4px ${b.status === 'completed' ? C.success : b.status === 'failed' ? C.error : b.status === 'running' ? C.secondary : C.warning}` }} />
                        <Box sx={{ minWidth:0 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight:600, color:'#fff', fontSize:13 }}>{b.name}</Typography>
                          <Typography variant="caption" noWrap sx={{ color:alpha('#fff',0.3), fontSize:11, display:'block' }}>
                            {(b.createdAt || '').slice(0,16).replace('T', ' ')}
                          </Typography>
                        </Box>
                      </Box>
                      <Chip label={b.status} size="small" sx={{ fontWeight:600, fontSize:9,
                        bgcolor:alpha(b.status === 'completed' ? C.success : b.status === 'failed' ? C.error : b.status === 'running' ? C.secondary : C.warning, 0.12),
                        color: b.status === 'completed' ? C.success : b.status === 'failed' ? C.error : b.status === 'running' ? C.secondary : C.warning,
                      }} />
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card sx={{ ...GLASS, display:'flex', flexDirection:'column' }}>
            <CardContent sx={{ p:3, display: 'flex', flexDirection: 'column', flex:1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2.5, color:'#fff' }}>{t('quickActions')}</Typography>
              <Stack spacing={1.5} sx={{ flex:1, justifyContent:'center' }}>
                {[
                  { label: t('newBackupBtn'), path:'/backups', grad:`linear-gradient(90deg, ${alpha(C.primary, 0.14)}, ${alpha(C.secondary, 0.1)})`, border:alpha(C.primary,0.28), icon:<BackupIcon sx={{ fontSize: 14 }} /> },
                  { label: t('restore'), path:'/restore', grad:`linear-gradient(90deg, ${alpha(C.secondary, 0.14)}, ${alpha(C.primary, 0.08)})`, border:alpha(C.secondary,0.28), icon:<RestoreIcon sx={{ fontSize: 14 }} /> },
                  { label: t('manageSchedulesBtn'), path:'/schedules', grad:`linear-gradient(90deg, ${alpha(C.warning, 0.12)}, ${alpha(C.warning, 0.05)})`, border:alpha(C.warning,0.26), icon:<ScheduleIcon sx={{ fontSize: 14 }} /> },
                  { label: t('exportDashboardBtn'), path:'#export', grad:`linear-gradient(90deg, ${alpha(C.success, 0.12)}, ${alpha(C.success, 0.05)})`, border:alpha(C.success,0.24), action: exportDashboard, icon:<DownloadIcon sx={{ fontSize: 14 }} /> },
                ].map(act => (
                  <Button key={act.label} fullWidth onClick={act.action || (() => navigate(act.path))}
                    sx={{ borderRadius:'12px', py:1.3, textTransform:'none', fontWeight:600, fontSize:13,
                      background:act.grad, color:'rgba(255,255,255,0.85)', border:`1px solid ${act.border}`,
                      justifyContent:'flex-start', px:2.5, '&:hover':{borderColor:'rgba(255,255,255,0.35)', color:'#fff'} }}>
                    <Box sx={{ width:22, height:22, borderRadius:'8px', border:'1px solid currentColor', mr:1.5, display:'flex', alignItems:'center', justifyContent:'center', flexShrink: 0 }}>
                      {act.icon}
                    </Box>
                    {act.label}
                  </Button>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Box>

        {/* ===== ROW 5: ACTIVE SCHEDULES — FULL WIDTH ===== */}
        <Card sx={{ ...GLASS, mb:4 }}>
          <CardContent sx={{ p:3 }}>
            <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:3, flexWrap:'wrap', gap:1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, color:'#fff' }}>{t('activeSchedules')}</Typography>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Chip label={`${activeSchedules} ${t('active').toLowerCase()}`} size="small" sx={{ bgcolor:alpha(C.secondary,0.12), color:C.secondary, fontWeight:600, fontSize:11 }} />
                <Button size="small" onClick={() => navigate('/schedules')} sx={{ borderRadius:'20px', textTransform:'none', fontSize:12, color:alpha('#fff',0.5), minWidth:0, p:'4px 12px', border:`1px solid ${C.border}` }}>
                  {t('actions')} <ArrowIcon sx={{ fontSize:14, ml:0.3 }} />
                </Button>
              </Stack>
            </Box>
            {scheduleList.length === 0 ? (
              <Box sx={{ display:'flex', alignItems:'center', gap:1.5, py:2 }}>
                <ScheduleIcon sx={{ color:alpha('#fff',0.12), fontSize:24 }} />
                <Typography variant="body2" sx={{ color:alpha('#fff',0.35), fontSize:13 }}>{t('noActiveSchedules')}</Typography>
              </Box>
            ) : (
              <Box sx={{ display:'grid', gridTemplateColumns: { xs:'1fr', sm:'repeat(2, minmax(0, 1fr))', xl:'repeat(4, minmax(0, 1fr))' }, gap:2 }}>
                {scheduleList.map((s) => (
                  <Box key={s.id} sx={{ p:2.5, borderRadius:2.5, bgcolor:'rgba(255,255,255,0.02)', border:`1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', '&:hover':{bgcolor:'rgba(255,255,255,0.04)'} }}>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight:700, color:'#fff', fontSize:13.5, mb:0.5 }}>{s.name}</Typography>
                      <Typography variant="caption" sx={{ fontFamily:'monospace', color:alpha('#fff',0.45), fontSize:11, display:'block' }}>
                        {s.cronExpression || s.cron || '—'}
                      </Typography>
                    </Box>
                    <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.3), fontSize:10.5 }}>
                        {t('nextRun')}: {s.nextRun ? s.nextRun.slice(0,10) : '—'}
                      </Typography>
                      <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:C.success, boxShadow:`0 0 6px ${C.success}` }} />
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </CardContent>
        </Card>

        {/* Retention Summary Footer */}
        <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mt:2, px:1, flexWrap:'wrap', gap:1 }}>
          <Typography variant="caption" sx={{ color:alpha('#fff',0.2), fontSize:11 }}>
            {t('retentionInfo', { days: retentionDays, total, expiring: oldBackups })}
          </Typography>
          <Typography variant="caption" sx={{ color:alpha('#fff',0.2), fontSize:11 }}>
            {t('lastUpdated')}: {new Date().toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US')}
          </Typography>
        </Box>
      </Box>
    </>
  );
}
