import { createTheme, alpha, ThemeOptions } from '@mui/material/styles'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

const primary = {
  main: '#1E88E5',
  light: '#64B5F6',
  dark: '#1565C0',
  contrastText: '#fff',
}

const secondary = {
  main: '#00ACC1',
  light: '#4DD0E1',
  dark: '#00838F',
}

const lightPalette = {
  mode: 'light' as const,
  primary,
  secondary,
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
}

const darkPalette = {
  mode: 'dark' as const,
  primary: {
    ...primary,
    main: '#64B5F6',
    light: '#90CAF9',
    dark: '#42A5F5',
  },
  secondary: {
    ...secondary,
    main: '#4DD0E1',
    light: '#80DEEA',
    dark: '#26C6DA',
  },
  success: { main: '#66BB6A', light: '#81C784', dark: '#4CAF50' },
  warning: { main: '#FFB74D', light: '#FFCC80', dark: '#FFA726' },
  error: { main: '#EF5350', light: '#E57373', dark: '#EF5350' },
  info: { main: '#64B5F6' },
  background: {
    default: '#0F1419',
    paper: '#1A1F2E',
  },
  text: {
    primary: '#E8ECF1',
    secondary: '#A0AEC0',
  },
  divider: '#2D3748',
}

const baseOptions: ThemeOptions = {
  typography: {
    fontFamily: '"Inter", "Segoe UI", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '1.5rem' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, fontSize: '1rem' },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  shadows: [
    'none',
    '0 1px 2px rgba(0, 0, 0, 0.04)',
    '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
    '0 4px 12px rgba(0, 0, 0, 0.06)',
    '0 8px 24px rgba(0, 0, 0, 0.08)',
    '0 12px 32px rgba(0, 0, 0, 0.1)',
    ...Array(19).fill('0 12px 32px rgba(0, 0, 0, 0.1)'),
  ] as any,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': {
          borderRadius: 8,
        },
        body: {
          transition: 'background-color 0.3s ease, color 0.3s ease',
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
          border: '1px solid',
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
            fontWeight: 600,
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            borderBottom: '1px solid',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { py: 1.25 },
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
            '& .MuiListItemIcon-root': { color: primary.main },
            '&:hover': { backgroundColor: alpha(primary.main, 0.16) },
          },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 4, height: 8 },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 12 },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
    },
    MuiSelect: {
      defaultProps: { size: 'small' },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { borderRadius: 8 },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderBottomWidth: 1 },
      },
    },
  },
}

export const getLightTheme = () => createTheme({
  ...baseOptions,
  palette: lightPalette,
  components: {
    ...baseOptions.components,
    MuiCssBaseline: {
      styleOverrides: {
        '*::-webkit-scrollbar-thumb': { backgroundColor: '#C5CDD8' },
        '*::-webkit-scrollbar-track': { backgroundColor: '#F0F3F7' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderColor: '#E2E8F0' },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            backgroundColor: '#F7F9FC',
            color: '#5C6B7A',
            borderBottomColor: '#E2E8F0',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: '#EEF2F6' },
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
        root: { backgroundColor: '#E8EEF5' },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          color: '#5C6B7A',
          '&.Mui-selected': { color: primary.dark },
        },
      },
    },
  },
})

export const getDarkTheme = () => createTheme({
  ...baseOptions,
  palette: darkPalette,
  components: {
    ...baseOptions.components,
    MuiCssBaseline: {
      styleOverrides: {
        '*::-webkit-scrollbar-thumb': { backgroundColor: '#4A5568' },
        '*::-webkit-scrollbar-track': { backgroundColor: '#1A1F2E' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid #2D3748',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
          backgroundImage: 'none',
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            backgroundColor: '#1A1F2E',
            color: '#A0AEC0',
            borderBottomColor: '#2D3748',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: '#2D3748' },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: '1px solid #2D3748',
          backgroundColor: '#1A1F2E',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#1A1F2E',
          color: '#E8ECF1',
          boxShadow: '0 1px 0 #2D3748',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { backgroundColor: '#2D3748' },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          color: '#A0AEC0',
          '&.Mui-selected': {
            backgroundColor: alpha('#64B5F6', 0.12),
            color: '#90CAF9',
            '& .MuiListItemIcon-root': { color: '#64B5F6' },
            '&:hover': { backgroundColor: alpha('#64B5F6', 0.16) },
          },
          '&:hover': { backgroundColor: alpha('#64B5F6', 0.08) },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: '#2D3748' },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: '#1A1F2E',
          border: '1px solid #2D3748',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#2D3748',
          color: '#E8ECF1',
          fontSize: '0.75rem',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8 },
        standardError: { backgroundColor: alpha('#EF5350', 0.15), color: '#EF5350' },
        standardWarning: { backgroundColor: alpha('#FFB74D', 0.15), color: '#FFB74D' },
        standardSuccess: { backgroundColor: alpha('#66BB6A', 0.15), color: '#66BB6A' },
        standardInfo: { backgroundColor: alpha('#64B5F6', 0.15), color: '#64B5F6' },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '& fieldset': { borderColor: '#2D3748' },
            '&:hover fieldset': { borderColor: '#4A5568' },
          },
        },
      },
    },
    MuiSelect: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#2D3748' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#4A5568' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 6 },
        filled: {
          '&.MuiChip-colorSuccess': { backgroundColor: alpha('#66BB6A', 0.2), color: '#66BB6A' },
          '&.MuiChip-colorError': { backgroundColor: alpha('#EF5350', 0.2), color: '#EF5350' },
          '&.MuiChip-colorWarning': { backgroundColor: alpha('#FFB74D', 0.2), color: '#FFB74D' },
          '&.MuiChip-colorInfo': { backgroundColor: alpha('#64B5F6', 0.2), color: '#64B5F6' },
        },
      },
    },
  },
})

export const ThemeModeContext = createContext<{
  mode: 'light' | 'dark'
  toggleMode: () => void
} | null>(null)

export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme-mode')
      if (stored) return stored as 'light' | 'dark'
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })

  useEffect(() => {
    localStorage.setItem('theme-mode', mode)
    document.documentElement.setAttribute('data-theme', mode)
  }, [mode])

  const toggleMode = () => setMode((prev) => (prev === 'light' ? 'dark' : 'light'))

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode }}>
      {children}
    </ThemeModeContext.Provider>
  )
}

export const useThemeMode = () => {
  const ctx = useContext(ThemeModeContext)
  if (!ctx) throw new Error('useThemeMode must be used within ThemeModeProvider')
  return ctx
}

export { createTheme, alpha } from '@mui/material/styles'
