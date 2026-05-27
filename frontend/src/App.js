import { useState, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { darkTheme, lightTheme } from './theme';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Backups from './pages/Backups';
import DatabaseBackups from './pages/DatabaseBackups';
import VMBackups from './pages/VMBackups';
import CloudBackups from './pages/CloudBackups';
import Restore from './pages/Restore';
import Policies from './pages/Policies';
import JobHistory from './pages/JobHistory';
import Schedules from './pages/Schedules';
import ActivityLog from './pages/ActivityLog';
import Repos from './pages/Repos';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Roles from './pages/Roles';

function ProtectedLayout({ isDark, toggleTheme }) {
  const { user } = useAuth();
  if (!user?.loggedIn) return <Navigate to="/login" replace />;

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <TopBar isDark={isDark} toggleTheme={toggleTheme} />
        <Box sx={{
          flex: 1,
          overflow: 'auto',
          p: 3,
          bgcolor: 'background.default',
          backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(6,182,212,0.04) 0%, transparent 50%)',
        }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/backups" element={<Backups />} />
            <Route path="/db-backups" element={<DatabaseBackups />} />
            <Route path="/vm-backups" element={<VMBackups />} />
            <Route path="/cloud-backups" element={<CloudBackups />} />
            <Route path="/restore" element={<Restore />} />
            <Route path="/policies" element={<Policies />} />
            <Route path="/history" element={<JobHistory />} />
            <Route path="/schedules" element={<Schedules />} />
            <Route path="/logs" element={<ActivityLog />} />
            <Route path="/repos" element={<Repos />} />
            <Route path="/settings" element={<Settings toggleTheme={toggleTheme} isDark={isDark} />} />
            <Route path="/users" element={<Users />} />
            <Route path="/roles" element={<Roles />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('bck-theme');
    return saved ? saved === 'dark' : true;
  });

  const theme = useMemo(() => {
    localStorage.setItem('bck-theme', isDark ? 'dark' : 'light');
    return isDark ? darkTheme : lightTheme;
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/*" element={<ProtectedLayout isDark={isDark} toggleTheme={toggleTheme} />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
