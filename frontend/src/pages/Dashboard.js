import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Grid, Card, CardContent, Typography, Chip, Button, Stack, Tooltip, alpha,
} from '@mui/material';
import {
  ArrowForward as ArrowIcon, Schedule as ScheduleIcon, Backup as BackupIcon,
  Storage as StorageIcon, CloudQueue as CloudIcon, Computer as ComputerIcon,
  Storage as DatabaseIcon, Speed as SpeedIcon, Timeline as TimelineIcon,
  Info as InfoIcon, Refresh as RefreshIcon, Download as DownloadIcon,
} from '@mui/icons-material';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, Area, AreaChart,
  CartesianGrid,
} from 'recharts';

const API = process.env.REACT_APP_API_URL || '';
const C = {
  indigo: '#6366f1', green: '#22c55e', red: '#ef4444', cyan: '#06b6d4',
  amber: '#f59e0b', border: 'rgba(255,255,255,0.06)',
};
const GLASS = {
  borderRadius: '20px', border: `1px solid ${C.border}`,
  background: 'linear-gradient(135deg, rgba(17,25,40,0.6) 0%, rgba(17,25,40,0.35) 100%)',
  backdropFilter: 'blur(20px)', boxShadow: '0 8px 32px rgba(0,0,0,0.37)',
  transition: 'all 0.3s',
  '&:hover': { borderColor: 'rgba(255,255,255,0.12)', transform: 'translateY(-2px)' },
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <Box sx={{ bgcolor: 'rgba(15,23,42,0.95)', border: `1px solid ${C.border}`, borderRadius: 2, px: 2, py: 1.5, backdropFilter: 'blur(12px)' }}>
        {label && <Typography variant="caption" sx={{ fontWeight: 600, color: alpha('#fff',0.6), mb: 0.5, display:'block' }}>{label}</Typography>}
        {payload.map(p => (
          <Box key={p.name} sx={{ display:'flex', alignItems:'center', gap:1, py:0.2 }}>
            <Box sx={{ width:8, height:8, borderRadius:'50%', bgcolor:p.color }} />
            <Typography variant="caption" sx={{ color:'#fff', fontWeight:500 }}>{p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value} {p.unit || ''}</Typography>
          </Box>
        ))}
      </Box>
    );
  }
  return null;
};

const StatCard = ({ label, value, icon, color, path, svg }) => {
  const navigate = useNavigate();
  return (
    <Card onClick={() => navigate(path)} sx={{ cursor:'pointer', height:'100%', ...GLASS }}>
      <CardContent sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', p:'16px !important' }}>
        <Box>
          <Typography variant="body2" sx={{ color:alpha('#fff',0.4), fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px' }}>
            {label}
          </Typography>
          <Typography variant="h3" sx={{ fontWeight:800, color:'#fff', mt:0.5, fontSize:32 }}>
            {value}
          </Typography>
        </Box>
        <Box sx={{ mr:-2 }}>{svg}</Box>
      </CardContent>
    </Card>
  );
};

const PlatformSVG = ({ gradientId, color, children, glowColor }) => (
  <svg width="140" height="95" viewBox="0 0 140 95" className="platform-shadow">
    <path d="M 20,48 L 70,25 L 120,48 L 70,71 Z" fill={`${color}12`} stroke={color} strokeWidth="1.2" opacity="0.6" />
    <path d="M 20,48 L 20,55 L 70,78 L 70,71 Z" fill={`${color}20`} stroke={color} strokeWidth="0.8" opacity="0.5" />
    <path d="M 70,71 L 70,78 L 120,55 L 120,48 Z" fill={`${color}08`} stroke={color} strokeWidth="0.8" opacity="0.5" />
    <ellipse cx="70" cy="46" rx="18" ry="8" fill={`${glowColor || color}`} opacity="0.2" filter="blur(6px)" />
    <g className="floating" style={{ transformOrigin:'70px 40px' }}>{children}</g>
    <defs>
      <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={color} stopOpacity="0.9" />
        <stop offset="50%" stopColor={color} stopOpacity="0.6" />
        <stop offset="100%" stopColor={color} stopOpacity="0.3" />
      </linearGradient>
    </defs>
  </svg>
);

export default function Dashboard() {
  const navigate = useNavigate();
  const [backups, setBackups] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [dbConnections, setDbConnections] = useState([]);
  const [cloudCreds, setCloudCreds] = useState([]);
  const [vmBackups, setVmBackups] = useState([]);

  const loadAll = () => {
    fetch(`${API}/api/backups`).then(r=>r.json()).then(setBackups).catch(()=>{});
    fetch(`${API}/api/schedules`).then(r=>r.json()).then(setSchedules).catch(()=>{});
    fetch(`${API}/api/logs`).then(r=>r.json()).then(setLogs).catch(()=>{});
    fetch(`${API}/api/db-connections`).then(r=>r.json()).then(setDbConnections).catch(()=>{});
    fetch(`${API}/api/cloud-credentials`).then(r=>r.json()).then(setCloudCreds).catch(()=>{});
    fetch(`${API}/api/vm-backups`).then(r=>r.json()).then(setVmBackups).catch(()=>{});
  };
  useEffect(() => { loadAll(); }, []);

  const total = backups.length;
  const completed = backups.filter(b => b.status === 'completed').length;
  const failed = backups.filter(b => b.status === 'failed').length;
  const running = backups.filter(b => b.status === 'running').length;
  const pending = backups.filter(b => b.status === 'pending').length;
  const activeSchedules = schedules.filter(s => s.enabled !== false).length;
  const successRate = total > 0 ? Math.round((completed/total)*100) : 0;
  const usedBytes = useMemo(() => backups.reduce((s,b) => s + (b.size || 0), 0), [backups]);
  const usedGB = Math.round(usedBytes / 1073741824 * 10) / 10 || 0;
  const storageLimit = 50;
  const storagePercent = Math.min((usedGB / storageLimit) * 100, 100);
  const recentLogs = logs.slice(0, 4);
  const totalConnections = dbConnections.length + cloudCreds.length + vmBackups.length;
  const avgSpeed = useMemo(() => {
    const withSpeed = backups.filter(b => b.speed);
    return withSpeed.length ? Math.round(withSpeed.reduce((s,b) => s + (b.speed || 0), 0) / withSpeed.length) : 0;
  }, [backups]);

  // Last 24h
  const last24h = useMemo(() => {
    const cutoff = Date.now() - 86400000;
    const recent = backups.filter(b => new Date(b.createdAt).getTime() > cutoff);
    return {
      total: recent.length,
      completed: recent.filter(b => b.status === 'completed').length,
      failed: recent.filter(b => b.status === 'failed').length,
      bytes: recent.reduce((s,b) => s + (b.size || 0), 0),
    };
  }, [backups]);
  const last24hGD = Math.round(last24h.bytes / 1073741824 * 100) / 100;

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

  // Connection status
  const connectionStatus = [
    { type:'Database', items: dbConnections, icon: <DatabaseIcon />, color: C.green, path: '/db-backups' },
    { type:'Cloud', items: cloudCreds, icon: <CloudIcon />, color: C.cyan, path: '/cloud-backups' },
    { type:'VM', items: vmBackups, icon: <ComputerIcon />, color: C.amber, path: '/vm-backups' },
  ];

  // Schedules list for bottom section
  const scheduleList = schedules.filter(s => s.enabled !== false).slice(0, 5);
  const recentBackups = backups.slice(0, 5);

  const exportDashboard = () => {
    window.print();
  };

  return (
    <>
      <style>{`
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes ambient { 0%{backgroundPosition:0% 50%} 50%{backgroundPosition:100% 50%} 100%{backgroundPosition:0% 50%} }
        .floating { animation: float 5s ease-in-out infinite; }
        .platform-shadow { filter: drop-shadow(0 12px 12px rgba(0,0,0,0.4)); }
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
        .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
        @media print { body { background: #0B0F19 !important; } }
      `}</style>

      {/* Animated background */}
      <Box sx={{
        position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:0, pointerEvents:'none', overflow:'hidden',
        background:'linear-gradient(-45deg, rgba(99,102,241,0.03), rgba(6,182,212,0.02), rgba(99,102,241,0.03), rgba(16,185,129,0.02))',
        backgroundSize:'400% 400%', animation:'ambient 15s ease infinite',
      }} />

      {/* Floating crystals */}
      {[['15%','40%','50','120','6s','0s'], ['40%','80%','35','90','8s','1s'], ['70%','8%','45','100','7s','2s'], ['85%','90%','30','70','5s','1.5s']].map((c,i) => (
        <Box key={i} sx={{
          position:'absolute', width:c[2]+'px', height:c[3]+'px', top:c[0], left:c[1], zIndex:0, pointerEvents:'none',
          background:'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))',
          backdropFilter:'blur(4px)', border:'1px solid rgba(255,255,255,0.05)', transform:'rotate(45deg)',
          borderRadius:'4px', animation:`float ${c[4]} ease-in-out infinite ${c[5]}`,
        }} />
      ))}

      <Box sx={{ position:'relative', zIndex:1, maxWidth:1600, mx:'auto', px:0 }}>
        {/* ===== HEADER ===== */}
        <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', mb:3 }}>
          <Box>
            <Box sx={{ display:'flex', alignItems:'center', gap:1.5, mb:0.3 }}>
              <Typography variant="h4" sx={{ fontWeight:800, letterSpacing:'-0.5px', color:'#fff' }}>Dashboard</Typography>
              <Tooltip title={`System ${successRate >= 80 ? 'healthy' : 'degraded'}`}>
                <Box sx={{ display:'flex', alignItems:'center', gap:0.5, px:1.5, py:0.3, borderRadius:'20px', bgcolor:alpha(successRate >= 80 ? C.green : C.amber, 0.12) }}>
                  <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:successRate >= 80 ? C.green : C.amber, boxShadow:`0 0 8px ${successRate >= 80 ? C.green : C.amber}`, className:'pulse-dot' }} />
                  <Typography variant="caption" sx={{ color:successRate >= 80 ? C.green : C.amber, fontWeight:600, fontSize:11 }}>
                    {successRate >= 80 ? 'Healthy' : total > 0 ? 'Degraded' : 'Idle'}
                  </Typography>
                </Box>
              </Tooltip>
            </Box>
            <Typography variant="body2" sx={{ color:alpha('#fff',0.4), fontSize:13, fontWeight:500 }}>
              {total > 0 ? `${successRate}% success · ${completed}/${total} · ${activeSchedules} active schedule(s)` : 'No backups configured yet'}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={loadAll} sx={{
              borderRadius:'30px', px:2.5, py:1, fontSize:12, fontWeight:600, textTransform:'none', minWidth:0,
              bgcolor:'rgba(255,255,255,0.03)', color:'rgba(255,255,255,0.6)', border:`1px solid ${C.border}`,
              '&:hover':{bgcolor:'rgba(255,255,255,0.08)'},
            }}><RefreshIcon sx={{ fontSize:16 }} /></Button>
            <Button onClick={exportDashboard} sx={{
              borderRadius:'30px', px:2.5, py:1, fontSize:12, fontWeight:600, textTransform:'none', minWidth:0,
              bgcolor:'rgba(255,255,255,0.03)', color:'rgba(255,255,255,0.6)', border:`1px solid ${C.border}`,
              '&:hover':{bgcolor:'rgba(255,255,255,0.08)'},
            }}><DownloadIcon sx={{ fontSize:16 }} /></Button>
            <Button onClick={() => navigate('/backups')} sx={{
              borderRadius:'30px', px:3, py:1, fontSize:13, fontWeight:600, textTransform:'none',
              bgcolor:'rgba(255,255,255,0.03)', color:'rgba(255,255,255,0.8)', border:`1px solid ${C.border}`,
              '&:hover':{bgcolor:'rgba(255,255,255,0.08)', borderColor:'rgba(255,255,255,0.2)'},
            }} endIcon={<ArrowIcon fontSize="small" />}>View All</Button>
          </Stack>
        </Box>

        {/* ===== ROW 1: STAT CARDS ===== */}
        <Grid container spacing={3} sx={{ mb:4 }}>
          {[
            { label:'Total Jobs', value:total, color:'#EAB308', path:'/backups', svg:
              <PlatformSVG gradientId="g1" color="#EAB308" glowColor="#EAB308">
                <path d="M55,42 a12,12 0 0,1 18,-10 a16,16 0 0,1 24,0 a12,12 0 0,1 0,18 L55,50 Z" fill="url(#g1)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG> },
            { label:'Completed', value:completed, color:C.green, path:'/backups', svg:
              <PlatformSVG gradientId="g2" color={C.green} glowColor={C.green}>
                <path d="M55,35 L68,48 L85,22" fill="none" stroke="url(#g2)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG> },
            { label:'Failed', value:failed, color:C.red, path:'/backups', svg:
              <PlatformSVG gradientId="g3" color={C.red} glowColor={C.red}>
                <path d="M58,18 L58,42 M58,50 L58,54" fill="none" stroke="url(#g3)" strokeWidth="7" strokeLinecap="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
              </PlatformSVG> },
            { label:'Active Now', value:running + pending, color:C.cyan, path:'/backups', svg:
              <PlatformSVG gradientId="g4" color={C.cyan} glowColor={C.cyan}>
                <circle cx="70" cy="36" r="14" fill="none" stroke="url(#g4)" strokeWidth="4" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
                <path d="M70,20 L70,24 M70,36 L70,28 M70,36 L78,36 M80,22 L84,26" stroke="url(#g4)" strokeWidth="3" strokeLinecap="round" />
              </PlatformSVG> },
          ].map((item,i) => (
            <Grid item xs={12} sm={6} md={3} key={i}><StatCard {...item} /></Grid>
          ))}
        </Grid>

        {/* ===== ROW 2: 3-COLUMN LAYOUT ===== */}
        <Grid container spacing={3} sx={{ mb:3 }}>
          {/* ---- COL 1 ---- */}
          <Grid item xs={12} md={4}>
            {/* System Overview + Connection Status */}
            <Card sx={{ ...GLASS, mb:3 }}>
              <CardContent sx={{ p:3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2, color:'#fff' }}>System Overview</Typography>
                <Stack spacing={1.5}>
                  {/* Sources */}
                  <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', p:1.5, borderRadius:2, bgcolor:'rgba(255,255,255,0.03)' }}>
                    <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
                      <Box sx={{ display:'flex', gap:0.5 }}>
                        {connectionStatus.map((t,i) => (
                          <Tooltip key={i} title={`${t.type}: ${t.items.length}`}>
                            <Box sx={{ cursor:'pointer', width:28, height:28, borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', bgcolor:alpha(t.color, 0.12), color:t.color, fontSize:14 }} onClick={() => navigate(t.path)}>
                              {t.icon}
                            </Box>
                          </Tooltip>
                        ))}
                      </Box>
                      <Typography variant="body2" sx={{ color:alpha('#fff',0.7), fontWeight:600, fontSize:13 }}>Sources</Typography>
                    </Box>
                    <Typography variant="h5" sx={{ fontWeight:800, color:'#fff', fontSize:22 }}>{totalConnections}</Typography>
                  </Box>

                  {/* Connection Status Indicators */}
                  {connectionStatus.map(t => (
                    <Box key={t.type} sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', pl:1, cursor:'pointer' }} onClick={() => navigate(t.path)}>
                      <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
                        <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:t.color, boxShadow:`0 0 6px ${t.color}` }} />
                        <Typography variant="body2" sx={{ color:alpha('#fff',0.6), fontSize:13 }}>{t.type}</Typography>
                      </Box>
                      <Box sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight:700, color:t.items.length > 0 ? '#fff' : alpha('#fff',0.3), fontSize:14 }}>
                          {t.items.length}
                        </Typography>
                        <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:t.items.length > 0 ? C.green : alpha('#fff',0.15) }} />
                      </Box>
                    </Box>
                  ))}

                  {/* Mini topology flow */}
                  <Box sx={{ display:'flex', alignItems:'center', justifyContent:'center', gap:1, pt:1 }}>
                    <Box sx={{ width:32, height:32, borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', bgcolor:alpha(C.indigo,0.15), color:C.indigo, fontSize:14 }}>
                      <StorageIcon sx={{ fontSize:16 }} />
                    </Box>
                    <Box sx={{ flex:1, height:2, mx:0.5, background:`linear-gradient(90deg, ${alpha(C.indigo,0.5)}, ${alpha(C.cyan,0.5)})`, position:'relative' }}>
                      <Box sx={{ position:'absolute', right:-4, top:-4, width:10, height:10, borderRadius:'50%', bgcolor:C.cyan }} />
                    </Box>
                    <Box sx={{ width:32, height:32, borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', bgcolor:alpha(C.cyan,0.15), color:C.cyan, fontSize:14 }}>
                      <BackupIcon sx={{ fontSize:16 }} />
                    </Box>
                    <Box sx={{ flex:1, height:2, mx:0.5, background:`linear-gradient(90deg, ${alpha(C.cyan,0.5)}, ${alpha(C.green,0.5)})`, position:'relative' }}>
                      <Box sx={{ position:'absolute', right:-4, top:-4, width:10, height:10, borderRadius:'50%', bgcolor:C.green }} />
                    </Box>
                    <Box sx={{ width:32, height:32, borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', bgcolor:alpha(C.green,0.15), color:C.green, fontSize:14 }}>
                      <CloudIcon sx={{ fontSize:16 }} />
                    </Box>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            {/* Last 24h Summary */}
            <Card sx={{ ...GLASS, mb:3 }}>
              <CardContent sx={{ p:3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2, color:'#fff' }}>Last 24 Hours</Typography>
                <Grid container spacing={1.5}>
                  <Grid item xs={4}>
                    <Box sx={{ textAlign:'center', p:1.5, borderRadius:2, bgcolor:'rgba(255,255,255,0.03)' }}>
                      <Typography variant="h5" sx={{ fontWeight:800, color:'#fff', fontSize:22 }}>{last24h.total}</Typography>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.4) }}>Total</Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={4}>
                    <Box sx={{ textAlign:'center', p:1.5, borderRadius:2, bgcolor:'rgba(255,255,255,0.03)' }}>
                      <Typography variant="h5" sx={{ fontWeight:800, color:C.green, fontSize:22 }}>{last24h.completed}</Typography>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.4) }}>Success</Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={4}>
                    <Box sx={{ textAlign:'center', p:1.5, borderRadius:2, bgcolor:'rgba(255,255,255,0.03)' }}>
                      <Typography variant="h5" sx={{ fontWeight:800, color:last24h.failed > 0 ? C.red : alpha('#fff',0.3), fontSize:22 }}>{last24h.failed}</Typography>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.4) }}>Failed</Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12}>
                    <Box sx={{ textAlign:'center', p:1.5, borderRadius:2, bgcolor:'rgba(255,255,255,0.03)' }}>
                      <Typography variant="body2" sx={{ color:alpha('#fff',0.6), fontSize:13 }}>
                        <strong>{last24hGD.toFixed(2)} GB</strong> transferred in {last24h.total} job{last24h.total !== 1 ? 's' : ''}
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* Performance */}
            <Card sx={{ ...GLASS }}>
              <CardContent sx={{ p:3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2.5, color:'#fff' }}>Performance</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Box sx={{ textAlign:'center', p:1.5, borderRadius:2, bgcolor:'rgba(255,255,255,0.03)' }}>
                      <SpeedIcon sx={{ color:C.cyan, fontSize:24, mb:0.5 }} />
                      <Typography variant="h5" sx={{ fontWeight:800, color:'#fff', fontSize:22 }}>{avgSpeed}</Typography>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.4) }}>MB/s avg</Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={6}>
                    <Box sx={{ textAlign:'center', p:1.5, borderRadius:2, bgcolor:'rgba(255,255,255,0.03)' }}>
                      <TimelineIcon sx={{ color:C.amber, fontSize:24, mb:0.5 }} />
                      <Typography variant="h5" sx={{ fontWeight:800, color:'#fff', fontSize:22 }}>{oldBackups}</Typography>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.4) }}>expiring &gt;{retentionDays}d</Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* ---- COL 2 ---- */}
          <Grid item xs={12} md={4}>
            {/* Storage */}
            <Card sx={{ ...GLASS, mb:3 }}>
              <CardContent sx={{ p:3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2, color:'#fff' }}>Storage</Typography>
                <Box sx={{ display:'flex', alignItems:'center', gap:2.5 }}>
                  <Box sx={{ position:'relative', flexShrink:0 }}>
                    <Box sx={{ width:110, height:110, borderRadius:'50%',
                      background: `conic-gradient(${C.indigo} ${storagePercent}%, rgba(255,255,255,0.03) ${storagePercent}%)`,
                      border:'4px solid rgba(255,255,255,0.03)', display:'flex', alignItems:'center', justifyContent:'center',
                    }}>
                      <Box sx={{ width:88, height:88, borderRadius:'50%', background:'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                        border:'1px solid rgba(255,255,255,0.06)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                        boxShadow:'inset 0 4px 12px rgba(0,0,0,0.2)' }}>
                        <Typography variant="h4" sx={{ fontWeight:800, lineHeight:1.1, fontSize:24, color:'#fff' }}>{Math.round(storagePercent)}%</Typography>
                        <Typography variant="caption" sx={{ color:alpha('#fff',0.4), fontSize:10, fontWeight:500 }}>used</Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ flex:1 }}>
                    <Box sx={{ display:'flex', justifyContent:'space-between', mb:0.5 }}>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.4) }}>Used</Typography>
                      <Typography variant="caption" sx={{ fontWeight:600, color:'#fff' }}>{usedGB.toFixed(1)} GB</Typography>
                    </Box>
                    <Box sx={{ height:6, borderRadius:3, bgcolor:'rgba(255,255,255,0.05)', overflow:'hidden', mb:1 }}>
                      <Box sx={{ height:'100%', borderRadius:3, width:`${storagePercent}%`, background:`linear-gradient(90deg, ${C.indigo}, ${C.cyan})`, transition:'width 1s' }} />
                    </Box>
                    <Typography variant="caption" sx={{ color:alpha('#fff',0.35), fontSize:11 }}>of {storageLimit} GB total</Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>

            {/* Daily Backup Size */}
            <Card sx={{ ...GLASS, mb:3 }}>
              <CardContent sx={{ p:3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, mb:0.3, color:'#fff' }}>Daily Backup Size</Typography>
                <Typography variant="caption" sx={{ color:alpha('#fff',0.3), display:'block', mb:1.5, fontSize:11 }}>GB per day</Typography>
                {sizeChartData.length === 0 ? (
                  <Box sx={{ py:4, textAlign:'center' }}>
                    <BarChart width={300} height={120} data={[{date:'—', sizeGB:0}]}>
                      <Bar dataKey="sizeGB" fill="rgba(255,255,255,0.05)" radius={[4,4,0,0]} />
                    </BarChart>
                    <Typography variant="body2" sx={{ color:alpha('#fff',0.3), mt:1, fontSize:13 }}>No data yet</Typography>
                  </Box>
                ) : (
                  <Box sx={{ width:'100%', height:140 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sizeChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="date" tickFormatter={v=>v.slice(5)} tick={{fontSize:10}} axisLine={false} tickLine={false} stroke={alpha('#fff',0.2)} />
                        <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false} stroke={alpha('#fff',0.2)} />
                        <ReTooltip content={<CustomTooltip />} />
                        <Bar dataKey="sizeGB" fill="url(#barGrad)" radius={[4,4,0,0]} maxBarSize={30} />
                        <defs>
                          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={C.indigo} stopOpacity={0.8} />
                            <stop offset="100%" stopColor={C.cyan} stopOpacity={0.3} />
                          </linearGradient>
                        </defs>
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card sx={{ ...GLASS }}>
              <CardContent sx={{ p:3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2, color:'#fff' }}>Recent Activity</Typography>
                {recentLogs.length === 0 ? (
                  <Box sx={{ py:3, textAlign:'center' }}>
                    <InfoIcon sx={{ color:alpha('#fff',0.12), fontSize:36, mb:1 }} />
                    <Typography variant="body2" sx={{ color:alpha('#fff',0.35), fontSize:13 }}>No recent activity</Typography>
                  </Box>
                ) : (
                  <Stack spacing={0.5}>
                    {recentLogs.map(log => (
                      <Box key={log.id} sx={{ display:'flex', gap:1.5, py:0.8, borderRadius:1.5, '&:hover':{bgcolor:'rgba(255,255,255,0.03)'} }}>
                        <Box sx={{ width:7, height:7, borderRadius:'50%', mt:0.6, flexShrink:0,
                          bgcolor: log.status === 'error' ? C.red : log.status === 'warning' ? C.amber : log.status === 'success' ? C.green : C.cyan,
                          boxShadow: `0 0 6px ${log.status === 'error' ? C.red : log.status === 'warning' ? C.amber : log.status === 'success' ? C.green : C.cyan}` }} />
                        <Box sx={{ minWidth:0, flex:1 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight:500, color:alpha('#fff',0.8), fontSize:13 }}>{log.message}</Typography>
                          <Typography variant="caption" sx={{ color:alpha('#fff',0.25), fontSize:11 }}>{(log.timestamp || '').slice(0,19).replace('T', ' ')}</Typography>
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* ---- COL 3 ---- */}
          <Grid item xs={12} md={4}>
            {/* Backup Timeline */}
            <Card sx={{ ...GLASS, mb:3 }}>
              <CardContent sx={{ p:3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, mb:0.3, color:'#fff' }}>Backup Timeline</Typography>
                <Typography variant="caption" sx={{ color:alpha('#fff',0.3), display:'block', mb:1.5, fontSize:11 }}>Daily backup activity</Typography>
                {timelineData.length === 0 ? (
                  <Box sx={{ py:4, textAlign:'center' }}>
                    <TimelineIcon sx={{ color:alpha('#fff',0.12), fontSize:36, mb:1 }} />
                    <Typography variant="body2" sx={{ color:alpha('#fff',0.3), fontSize:13 }}>No data yet</Typography>
                  </Box>
                ) : (
                  <Box sx={{ width:'100%', height:150 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timelineData}>
                        <defs>
                          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={C.green} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={C.green} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="date" tickFormatter={v=>v.slice(5)} tick={{fontSize:10}} axisLine={false} tickLine={false} stroke={alpha('#fff',0.2)} />
                        <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false} stroke={alpha('#fff',0.2)} />
                        <ReTooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="completed" stroke={C.green} fill="url(#areaGrad)" strokeWidth={2} />
                        {timelineData.some(d => d.failed > 0) && <Area type="monotone" dataKey="failed" stroke={C.red} fill="none" strokeWidth={1.5} strokeDasharray="4 4" />}
                      </AreaChart>
                    </ResponsiveContainer>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Recent Backups */}
            <Card sx={{ ...GLASS, mb:3 }}>
              <CardContent sx={{ p:3 }}>
                <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight:700, color:'#fff' }}>Recent Backups</Typography>
                  <Chip label={`${total} total`} size="small" sx={{ bgcolor:'rgba(255,255,255,0.06)', color:alpha('#fff',0.5), fontWeight:600, fontSize:11 }} />
                </Box>
                {recentBackups.length === 0 ? (
                  <Box sx={{ py:3, textAlign:'center' }}>
                    <BackupIcon sx={{ color:alpha('#fff',0.12), fontSize:36, mb:1 }} />
                    <Typography variant="body2" sx={{ color:alpha('#fff',0.35), mb:1.5, fontSize:13 }}>No backups yet</Typography>
                    <Button fullWidth onClick={() => navigate('/backups')} sx={{
                      borderRadius:'12px', py:1.2, textTransform:'none', fontWeight:700, fontSize:12,
                      background:'linear-gradient(90deg, #4f46e5, #3b82f6)', color:'#fff',
                      boxShadow:'0 4px 16px rgba(99,102,241,0.2)',
                      '&:hover':{background:'linear-gradient(90deg, #4338ca, #2563eb)'},
                    }}>Create your first backup</Button>
                  </Box>
                ) : (
                  <Stack spacing={0.5}>
                    {recentBackups.map((b,i) => (
                      <Box key={b.id} sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', py:0.8, px:1, borderRadius:1.5, '&:hover':{bgcolor:'rgba(255,255,255,0.03)'}, cursor:'pointer' }} onClick={() => navigate('/backups')}>
                        <Box sx={{ display:'flex', alignItems:'center', gap:1.5, minWidth:0, flex:1 }}>
                          <Box sx={{ width:6, height:6, borderRadius:'50%', flexShrink:0,
                            bgcolor: b.status === 'completed' ? C.green : b.status === 'failed' ? C.red : b.status === 'running' ? C.cyan : C.amber,
                            boxShadow: `0 0 4px ${b.status === 'completed' ? C.green : b.status === 'failed' ? C.red : b.status === 'running' ? C.cyan : C.amber}` }} />
                          <Box sx={{ minWidth:0 }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight:600, color:'#fff', fontSize:13 }}>{b.name}</Typography>
                            <Typography variant="caption" noWrap sx={{ color:alpha('#fff',0.3), fontSize:11, display:'block' }}>
                              {(b.createdAt || '').slice(0,16).replace('T', ' ')}
                            </Typography>
                          </Box>
                        </Box>
                        <Chip label={b.status} size="small" sx={{ fontWeight:600, fontSize:10,
                          bgcolor:alpha(b.status === 'completed' ? C.green : b.status === 'failed' ? C.red : b.status === 'running' ? C.cyan : C.amber, 0.12),
                          color: b.status === 'completed' ? C.green : b.status === 'failed' ? C.red : b.status === 'running' ? C.cyan : C.amber,
                        }} />
                      </Box>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>

            {/* Quick Actions + Export */}
            <Card sx={{ ...GLASS }}>
              <CardContent sx={{ p:3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight:700, mb:2, color:'#fff' }}>Quick Actions</Typography>
                <Stack spacing={1}>
                  {[
                    { label:'New Backup', path:'/backups', grad:'linear-gradient(90deg, rgba(99,102,241,0.15), rgba(168,85,247,0.15))', border:'rgba(168,85,247,0.3)' },
                    { label:'Restore', path:'/restore', grad:'linear-gradient(90deg, rgba(59,130,246,0.15), rgba(6,182,212,0.15))', border:'rgba(6,182,212,0.3)' },
                    { label:'Manage Schedules', path:'/schedules', grad:'linear-gradient(90deg, rgba(234,179,8,0.1), rgba(249,115,22,0.1))', border:'rgba(249,115,22,0.25)' },
                    { label:'Export Dashboard', path:'#export', grad:'linear-gradient(90deg, rgba(16,185,129,0.1), rgba(16,185,129,0.05))', border:'rgba(16,185,129,0.2)', action: exportDashboard },
                  ].map(act => (
                    <Button key={act.label} fullWidth onClick={act.action || (() => navigate(act.path))}
                      sx={{ borderRadius:'12px', py:1.3, textTransform:'none', fontWeight:600, fontSize:13,
                        background:act.grad, color:'rgba(255,255,255,0.85)', border:`1px solid ${act.border}`,
                        justifyContent:'flex-start', px:2.5, '&:hover':{borderColor:'rgba(255,255,255,0.3)', color:'#fff'} }}>
                      <Box sx={{ width:18, height:18, borderRadius:'50%', border:'1.5px solid currentColor', mr:1.5, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800 }}>
                        {act.label === 'New Backup' ? '↑' : act.label === 'Restore' ? '↺' : act.label === 'Manage Schedules' ? '⚙' : '↓'}
                      </Box>
                      {act.label}
                    </Button>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* ===== BOTTOM ROW: Active Schedules ===== */}
        <Card sx={{ ...GLASS }}>
          <CardContent sx={{ p:3 }}>
            <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight:700, color:'#fff' }}>Active Schedules</Typography>
              <Stack direction="row" spacing={1}>
                <Chip label={`${activeSchedules} active`} size="small" sx={{ bgcolor:alpha(C.cyan,0.12), color:C.cyan, fontWeight:600, fontSize:11 }} />
                <Button size="small" onClick={() => navigate('/schedules')} sx={{ borderRadius:'20px', textTransform:'none', fontSize:12, color:alpha('#fff',0.5), minWidth:0, p:'4px 12px', border:`1px solid ${C.border}` }}>
                  Manage <ArrowIcon sx={{ fontSize:14, ml:0.3 }} />
                </Button>
              </Stack>
            </Box>
            {scheduleList.length === 0 ? (
              <Box sx={{ display:'flex', alignItems:'center', gap:1.5, py:2 }}>
                <ScheduleIcon sx={{ color:alpha('#fff',0.15), fontSize:20 }} />
                <Typography variant="body2" sx={{ color:alpha('#fff',0.3), fontSize:13 }}>No active schedules. Create one to automate backups.</Typography>
              </Box>
            ) : (
              <Grid container spacing={1.5}>
                {scheduleList.map((s,i) => (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={s.id}>
                    <Box sx={{ p:2, borderRadius:2, bgcolor:'rgba(255,255,255,0.03)', border:`1px solid ${C.border}`, '&:hover':{bgcolor:'rgba(255,255,255,0.06)'} }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight:700, color:'#fff', fontSize:13, mb:0.5 }}>{s.name}</Typography>
                      <Typography variant="caption" sx={{ fontFamily:'monospace', color:alpha('#fff',0.35), fontSize:11, display:'block', mb:1 }}>
                        {s.cronExpression || s.cron || '—'}
                      </Typography>
                      <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <Typography variant="caption" sx={{ color:alpha('#fff',0.3), fontSize:10 }}>
                          Next: {s.nextRun ? s.nextRun.slice(0,10) : '—'}
                        </Typography>
                        <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:C.green, boxShadow:`0 0 6px ${C.green}` }} />
                      </Box>
                    </Box>
                  </Grid>
                ))}
                {scheduleList.length < activeSchedules && (
                  <Grid item xs={12} sm={6} md={4} lg={3}>
                    <Box sx={{ p:2, borderRadius:2, border:`1px dashed ${C.border}`, textAlign:'center', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <Typography variant="caption" sx={{ color:alpha('#fff',0.25), fontSize:12 }}>
                        +{activeSchedules - scheduleList.length} more
                      </Typography>
                    </Box>
                  </Grid>
                )}
              </Grid>
            )}
          </CardContent>
        </Card>

        {/* Retention Summary Footer */}
        <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mt:2, px:1 }}>
          <Typography variant="caption" sx={{ color:alpha('#fff',0.2), fontSize:11 }}>
            Retention: {retentionDays} days · {total} backup{total !== 1 ? 's' : ''} stored · {oldBackups} expiring soon
          </Typography>
          <Typography variant="caption" sx={{ color:alpha('#fff',0.2), fontSize:11 }}>
            Last updated: {new Date().toLocaleString()}
          </Typography>
        </Box>
      </Box>
    </>
  );
}
