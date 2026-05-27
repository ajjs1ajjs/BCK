import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const API = process.env.REACT_APP_API_URL || '';

const adminPerms = { manageUsers: true, manageBackups: true, manageSchedules: true, restore: true, delete: true, configure: true, viewLogs: true, manageRoles: true };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('bck-auth');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return { username: 'admin', role: 'admin', permissions: { ...adminPerms }, loggedIn: true };
  });

  const login = useCallback(async (username, password) => {
    try {
      const r = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) return false;
      const data = await r.json();
      const u = { ...data, loggedIn: true };
      localStorage.setItem('bck-auth', JSON.stringify(u));
      setUser(u);
      return true;
    } catch {
      // Fallback: built-in users for demo
      const builtin = { admin: '291263', operator: 'operator', viewer: 'viewer' };
      if (builtin[username] === password) {
        const perms = {
          admin: { manageUsers: true, manageBackups: true, manageSchedules: true, restore: true, delete: true, configure: true, viewLogs: true, manageRoles: true },
          operator: { manageUsers: false, manageBackups: true, manageSchedules: true, restore: true, delete: false, configure: false, viewLogs: true, manageRoles: false },
          viewer: { manageUsers: false, manageBackups: false, manageSchedules: false, restore: false, delete: false, configure: false, viewLogs: true, manageRoles: false },
        };
        const u = { username, role: username, permissions: perms[username] || {}, loggedIn: true };
        localStorage.setItem('bck-auth', JSON.stringify(u));
        setUser(u);
        return true;
      }
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('bck-auth');
    setUser({ loggedIn: false });
  }, []);

  const can = useCallback((action) => {
    return user?.permissions?.[action] === true;
  }, [user]);

  const value = useMemo(() => ({
    user, login, logout, can,
    isAdmin: user?.role === 'admin',
    username: user?.username || '',
    role: user?.role || 'viewer',
  }), [user, login, logout, can]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
