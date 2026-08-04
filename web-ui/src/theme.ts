import { createTheme, alpha } from '@mui/material/styles'

// Nakivo-inspired enterprise backup console palette
const primary = {
  main: '#1E88E5',
  light: '#64B5F6',
  dark: '#1565C0',
  contrastText: '#fff',
}

const theme = createTheme({
  palette: {
    mode: 'light',
    primary,
    secondary: {
      main: '#00ACC1',
      light: '#4DD0E1',
      dark: '#00838F',
    },
    success: { main: '#43A047', light: '#66BB6A', dark: '#2E7D32' },
    warning: { main: '#FB8C00', light: '#FFB74D', dark: '#EF6C00' },
    error: { main: '#E53935', light: '#EF5350', dark: '#C62828' },
    info: { main: '#1E88E5' },
    background: {
      default: '#F0F3F7',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1A2332',
      secondary: '#5C6B7A',
    },
    divider: '#E2E8F0',
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '1.5rem' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, fontSize: '1rem' },
    subtitle2: { fontWeight: 600, color: '#5C6B7A' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  shadows: [
    'none',
    '0 1px 2px rgba(16, 24, 40, 0.04)',
    '0 1px 3px rgba(16, 24, 40, 0.06), 0 1px 2px rgba(16, 24, 40, 0.04)',
    '0 4px 12px rgba(16, 24, 40, 0.06)',
    '0 8px 24px rgba(16, 24, 40, 0.08)',
    '0 12px 32px rgba(16, 24, 40, 0.1)',
    ...Array(19).fill('0 12px 32px rgba(16, 24, 40, 0.1)'),
  ] as any,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#F0F3F7',
        },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: '#C5CDD8',
          borderRadius: 8,
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8, paddingInline: 16 },
        containedPrimary: {
          background: 'linear-gradient(180deg, #2B95EF 0%, #1E88E5 100%)',
          '&:hover': { background: 'linear-gradient(180deg, #1E88E5 0%, #1565C0 100%)' },
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid #E2E8F0',
          boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04)',
          backgroundImage: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            backgroundColor: '#F7F9FC',
            color: '#5C6B7A',
            fontWeight: 600,
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            borderBottom: '1px solid #E2E8F0',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: '#EEF2F6', py: 1.25 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 6 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          marginInline: 8,
          marginBlock: 2,
          '&.Mui-selected': {
            backgroundColor: alpha(primary.main, 0.12),
            color: primary.dark,
            '& .MuiListItemIcon-root': { color: primary.main },
            '&:hover': { backgroundColor: alpha(primary.main, 0.16) },
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: '1px solid #E2E8F0',
          backgroundColor: '#FFFFFF',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          color: '#1A2332',
          boxShadow: '0 1px 0 #E2E8F0',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 4, height: 8, backgroundColor: '#E8EEF5' },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 12 },
      },
    },
  },
})

export default theme
