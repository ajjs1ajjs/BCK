import { Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export const C = {
  primary: '#38bdf8',
  secondary: '#8b5cf6',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#f43f5e',
  surface: 'rgba(15,23,42,0.72)',
  border: 'rgba(148, 163, 184, 0.16)',
  borderStrong: 'rgba(56, 189, 248, 0.34)',
};

export const GLASS = {
  borderRadius: '16px',
  border: `1px solid ${C.border}`,
  background: `linear-gradient(145deg, ${C.surface} 0%, rgba(12,18,30,0.82) 100%)`,
  backdropFilter: 'blur(18px)',
  boxShadow: '0 18px 46px rgba(2,6,23,0.28)',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
  minWidth: 0,
  '&:hover': {
    borderColor: C.borderStrong,
    boxShadow: '0 22px 52px rgba(2,6,23,0.36), 0 0 0 1px rgba(56,189,248,0.08)',
    transform: 'translateY(-2px)'
  },
};

export const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <Box sx={{ bgcolor: 'rgba(15,23,42,0.95)', border: `1px solid ${C.border}`, borderRadius: 2, px: 2, py: 1.5, backdropFilter: 'blur(12px)' }}>
        {label && <Typography variant="caption" sx={{ fontWeight: 600, color: '#ffffff99', mb: 0.5, display:'block' }}>{label}</Typography>}
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

export const StatCard = ({ label, value, icon, color, path, svg }) => {
  const navigate = useNavigate();
  return (
    <Box onClick={() => navigate(path)} sx={{ cursor:'pointer', height:'100%', width: '100%', ...GLASS }}>
      <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap: 1.5, p:'18px !important', minWidth: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:0, lineHeight: 1.25 }}>
            {label}
          </Typography>
          <Typography variant="h3" sx={{ fontWeight:800, color:'#fff', mt:0.75, fontSize:32, lineHeight: 1 }}>
            {value}
          </Typography>
        </Box>
        {svg && <Box sx={{ flexShrink:0 }}>{svg}</Box>}
      </Box>
    </Box>
  );
};

export const PlatformSVG = ({ gradientId, color, children, glowColor }) => (
  <svg width="96" height="66" viewBox="0 0 140 95" className="platform-shadow">
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
