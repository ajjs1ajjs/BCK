import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Jobs from './pages/Jobs'
import Repositories from './pages/Repositories'
import Snapshots from './pages/Snapshots'
import Restore from './pages/Restore'
import Admin from './pages/Admin'
import Login from './pages/Login'
import Layout from './components/Layout'
import { getToken } from './api/client'

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />
  }
  return children
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/repositories" element={<Repositories />} />
        <Route path="/snapshots" element={<Snapshots />} />
        <Route path="/restore" element={<Restore />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
