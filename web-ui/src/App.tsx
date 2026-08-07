import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Jobs from './pages/Jobs'
import Repositories from './pages/Repositories'
import Snapshots from './pages/Snapshots'
import Restore from './pages/Restore'
import Admin from './pages/Admin'
import Sobr from './pages/Sobr'
import Cloud from './pages/Cloud'
import M365 from './pages/M365'
import Tape from './pages/Tape'
import Dr from './pages/Dr'
import Tenants from './pages/Tenants'
import Hypervisors from './pages/Hypervisors'
import SelfService from './pages/SelfService'
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
        <Route path="/sobr" element={<Sobr />} />
        <Route path="/cloud" element={<Cloud />} />
        <Route path="/m365" element={<M365 />} />
        <Route path="/tape" element={<Tape />} />
        <Route path="/dr" element={<Dr />} />
        <Route path="/tenants" element={<Tenants />} />
        <Route path="/hypervisors" element={<Hypervisors />} />
        <Route path="/portal" element={<SelfService />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
