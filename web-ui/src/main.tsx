import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CssBaseline } from '@mui/material'
import { ThemeModeProvider, getLightTheme, getDarkTheme } from './theme'
import App from './App'

const ThemedApp = () => {
  return (
    <ThemeModeProvider>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
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
