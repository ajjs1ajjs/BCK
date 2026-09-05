import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { ThemeModeProvider, useThemeMode, getLightTheme, getDarkTheme } from './theme'
import App from './App'

const ThemeApplier = ({ children }: { children: React.ReactNode }) => {
  const { mode } = useThemeMode()
  const theme = mode === 'dark' ? getDarkTheme() : getLightTheme()
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}

const ThemedApp = () => {
  return (
    <ThemeModeProvider>
      <ThemeApplier>
        <CssBaseline />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeApplier>
    </ThemeModeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <ThemedApp />
    </QueryClientProvider>
  </React.StrictMode>,
)
