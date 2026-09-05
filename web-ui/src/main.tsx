import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CssBaseline } from '@mui/material'
import { ThemeModeProvider, useThemeMode, getLightTheme, getDarkTheme } from './theme'
import App from './App'

const queryClient = new QueryClient()

const ThemedApp = () => {
  const { mode } = useThemeMode()
  const theme = mode === 'dark' ? getDarkTheme() : getLightTheme()
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ThemeModeProvider>
        <CssBaseline />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeModeProvider>
    </QueryClientProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>,
)
