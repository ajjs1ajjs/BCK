import { useNavigate } from 'react-router-dom';

export const C = {
  primary: '#38bdf8',
  secondary: '#8b5cf6',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#f43f5e',
};

export const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-4 py-3 backdrop-blur-md shadow-xl">
        {label && <p className="text-xs font-semibold text-white/60 mb-1">{label}</p>}
        {payload.map(p => (
          <div key={p.name} className="flex items-center gap-2 py-0.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <p className="text-xs text-white font-medium">
              {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value} {p.unit || ''}
            </p>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export const StatCard = ({ label, value, icon, color, path, svg }) => {
  const navigate = useNavigate();
  return (
    <div 
      onClick={() => navigate(path)} 
      className="cursor-pointer h-full w-full glass-card hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-blue-500/10 transition-all duration-300"
    >
      <div className="flex items-center justify-between gap-3 p-5 h-full">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider leading-tight">
            {label}
          </p>
          <h3 className="font-extrabold text-slate-900 dark:text-white mt-1 text-3xl leading-none">
            {value}
          </h3>
        </div>
        {svg && <div className="shrink-0">{svg}</div>}
      </div>
    </div>
  );
};

export const PlatformSVG = ({ gradientId, color, children, glowColor }) => (
  <svg width="96" height="66" viewBox="0 0 140 95" className="filter drop-shadow-md max-w-full h-auto">
    <path d="M 20,48 L 70,25 L 120,48 L 70,71 Z" fill={`${color}12`} stroke={color} strokeWidth="1.2" opacity="0.6" />
    <path d="M 20,48 L 20,55 L 70,78 L 70,71 Z" fill={`${color}20`} stroke={color} strokeWidth="0.8" opacity="0.5" />
    <path d="M 70,71 L 70,78 L 120,55 L 120,48 Z" fill={`${color}08`} stroke={color} strokeWidth="0.8" opacity="0.5" />
    <ellipse cx="70" cy="46" rx="18" ry="8" fill={`${glowColor || color}`} opacity="0.2" filter="blur(6px)" />
    <g className="animate-float origin-[70px_40px]">{children}</g>
    <defs>
      <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={color} stopOpacity="0.9" />
        <stop offset="50%" stopColor={color} stopOpacity="0.6" />
        <stop offset="100%" stopColor={color} stopOpacity="0.3" />
      </linearGradient>
    </defs>
  </svg>
);
