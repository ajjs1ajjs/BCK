import { createTheme } from '@mui/material/styles';

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#38bdf8', light: '#7dd3fc', dark: '#0284c7' },
    secondary: { main: '#8b5cf6', light: '#a78bfa', dark: '#6d28d9' },
    success: { main: '#22c55e', light: '#4ade80', dark: '#16a34a' },
    warning: { main: '#f59e0b', light: '#fbbf24', dark: '#d97706' },
    error: { main: '#f43f5e', light: '#fb7185', dark: '#e11d48' },
    info: { main: '#38bdf8' },
    background: {
      default: '#0b1120',
      paper: 'rgba(15,23,42,0.72)',
    },
    text: {
      primary: '#f1f5f9',
      secondary: '#94a3b8',
    },
    divider: 'rgba(148, 163, 184, 0.12)',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700, fontSize: '1.75rem', letterSpacing: '-0.02em' },
    h5: { fontWeight: 600, fontSize: '1.25rem' },
    h6: { fontWeight: 600, fontSize: '1.1rem' },
    body2: { fontSize: '0.875rem' },
    caption: { fontSize: '0.75rem', color: '#64748b' },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage: 'radial-gradient(ellipse at 18% 44%, rgba(56,189,248,0.07) 0%, transparent 58%), radial-gradient(ellipse at 82% 18%, rgba(34,197,94,0.045) 0%, transparent 50%), radial-gradient(ellipse at 55% 90%, rgba(139,92,246,0.04) 0%, transparent 48%)',
          backgroundAttachment: 'fixed',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(15,23,42,0.72)',
          backdropFilter: 'blur(18px)',
          border: '1px solid rgba(148, 163, 184, 0.16)',
          boxShadow: '0 18px 46px rgba(2,6,23,0.28)',
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
          '&:hover': {
            borderColor: 'rgba(56, 189, 248, 0.34)',
            boxShadow: '0 22px 52px rgba(2,6,23,0.36), 0 0 0 1px rgba(56,189,248,0.08)',
            transform: 'translateY(-2px)'
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, borderRadius: 10, padding: '8px 20px' },
        contained: {
          boxShadow: 'none',
          background: 'linear-gradient(135deg, #38bdf8, #8b5cf6)',
          '&:hover': { boxShadow: '0 4px 20px rgba(56,189,248,0.26)', background: 'linear-gradient(135deg, #0ea5e9, #7c3aed)' },
        },
        outlined: {
          borderColor: 'rgba(148,163,184,0.2)',
          '&:hover': { borderColor: 'rgba(148,163,184,0.4)', background: 'rgba(148,163,184,0.04)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
        filled: { background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' },
        outlined: { borderColor: 'rgba(148,163,184,0.15)' },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(15,23,42,0.9)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(148,163,184,0.1)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: 'rgba(0,0,0,0.2)',
            '& fieldset': { borderColor: 'rgba(148,163,184,0.12)' },
            '&:hover fieldset': { borderColor: 'rgba(148,163,184,0.3)' },
            '&.Mui-focused fieldset': { borderColor: '#38bdf8' },
          },
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': { backgroundColor: 'rgba(56, 189, 248, 0.04)' },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: 'rgba(148, 163, 184, 0.06)', padding: '12px 16px' },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: 'rgba(11,15,25,0.9)',
          backdropFilter: 'blur(20px)',
          borderRight: '1px solid rgba(148,163,184,0.06)',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: 'rgba(15,23,42,0.92)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(148,163,184,0.08)',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': {
            backgroundColor: 'rgba(56,189,248,0.1) !important',
          },
        },
      },
    },
  },
});

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#6366f1', light: '#818cf8', dark: '#4f46e5' },
    secondary: { main: '#0891b2', light: '#22d3ee', dark: '#065f73' },
    success: { main: '#16a34a', light: '#4ade80', dark: '#15803d' },
    warning: { main: '#d97706', light: '#fbbf24', dark: '#b45309' },
    error: { main: '#dc2626', light: '#f87171', dark: '#b91c1c' },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    text: {
      primary: '#0f172a',
      secondary: '#475569',
    },
    divider: 'rgba(0, 0, 0, 0.08)',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700, fontSize: '1.75rem' },
    h5: { fontWeight: 600, fontSize: '1.25rem' },
    h6: { fontWeight: 600, fontSize: '1.1rem' },
    body2: { fontSize: '0.875rem' },
    caption: { fontSize: '0.75rem', color: '#94a3b8' },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(0, 0, 0, 0.06)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, borderRadius: 10, padding: '8px 20px' },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none' } } },
    MuiTableRow: {
      styleOverrides: {
        root: { '&:hover': { backgroundColor: 'rgba(99, 102, 241, 0.03)' } },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: 'rgba(0, 0, 0, 0.06)', padding: '12px 16px' },
      },
    },
  },
});
