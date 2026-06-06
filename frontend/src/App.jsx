import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LangProvider } from './context/LangContext';
import { SocketProvider } from './context/SocketContext';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ErrorBoundary from './components/ErrorBoundary';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Backups = lazy(() => import('./pages/Backups'));
const DatabaseBackups = lazy(() => import('./pages/DatabaseBackups'));
const VMBackups = lazy(() => import('./pages/VMBackups'));
const HostBackups = lazy(() => import('./pages/HostBackups'));
const CloudBackups = lazy(() => import('./pages/CloudBackups'));
const SshBackups = lazy(() => import('./pages/SshBackups'));
const Restore = lazy(() => import('./pages/Restore'));
const Policies = lazy(() => import('./pages/Policies'));
const JobHistory = lazy(() => import('./pages/JobHistory'));
const Schedules = lazy(() => import('./pages/Schedules'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const Repos = lazy(() => import('./pages/Repos'));
const Settings = lazy(() => import('./pages/Settings'));
const Users = lazy(() => import('./pages/Users'));
const Roles = lazy(() => import('./pages/Roles'));
const ApiTokens = lazy(() => import('./pages/ApiTokens'));
const Organizations = lazy(() => import('./pages/Organizations'));

function ProtectedLayout({ isDark, toggleTheme }) {
  const { loggedIn } = useAuth();
  if (!loggedIn) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar isDark={isDark} toggleTheme={toggleTheme} />
        <main className="flex-1 overflow-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-900 animate-ambient" 
              style={{ 
                backgroundImage: 'radial-gradient(ellipse at 18% 44%, rgba(56,189,248,0.07) 0%, transparent 58%), radial-gradient(ellipse at 82% 18%, rgba(34,197,94,0.045) 0%, transparent 50%), radial-gradient(ellipse at 55% 90%, rgba(139,92,246,0.04) 0%, transparent 48%)' 
              }}>
          <ErrorBoundary>
            <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" /></div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/backups" element={<Backups />} />
                <Route path="/db-backups" element={<DatabaseBackups />} />
                <Route path="/vm-backups" element={<VMBackups />} />
                <Route path="/host-backups" element={<HostBackups />} />
                <Route path="/cloud-backups" element={<CloudBackups />} />
                <Route path="/ssh-backups" element={<SshBackups />} />
                <Route path="/restore" element={<Restore />} />
                <Route path="/policies" element={<Policies />} />
                <Route path="/history" element={<JobHistory />} />
                <Route path="/schedules" element={<Schedules />} />
                <Route path="/logs" element={<ActivityLog />} />
                <Route path="/repos" element={<Repos />} />
                <Route path="/settings" element={<Settings toggleTheme={toggleTheme} isDark={isDark} />} />
                <Route path="/users" element={<Users />} />
                <Route path="/roles" element={<Roles />} />
                <Route path="/tokens" element={<ApiTokens />} />
                <Route path="/organizations" element={<Organizations />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('bck-theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    localStorage.setItem('bck-theme', isDark ? 'dark' : 'light');
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return (
    <LangProvider>
      <SocketProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/*" element={<ProtectedLayout isDark={isDark} toggleTheme={toggleTheme} />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </SocketProvider>
    </LangProvider>
  );
}
