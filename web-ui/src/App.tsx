import { Routes, Route, Navigate } from 'react-router-dom'
import { Box } from '@mui/material'
import Dashboard from './pages/Dashboard'
import Jobs from './pages/Jobs'
import Restore from './pages/Restore'
import Admin from './pages/Admin'
import Layout from './components/Layout'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/restore" element={<Restore />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
    </Routes>
  )
}

export default App
