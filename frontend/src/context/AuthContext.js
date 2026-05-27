import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const API = process.env.REACT_APP_API_URL || '';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('bck-auth');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return null;
  });

  const login = useCallback(async (username, password) => {
    try {
      const r = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) {
        if (r.status === 429) return false;
        return false;
      }
      const data = await r.json();
      const u = { ...data, loggedIn: true, token: data.token };
      localStorage.setItem('bck-auth', JSON.stringify(u));
      setUser(u);
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('bck-auth');
    setUser(null);
  }, []);

  const can = useCallback((action) => {
    return user?.permissions?.[action] === true;
  }, [user]);

  const value = useMemo(() => ({
    user, login, logout, can,
    token: user?.token || null,
    isAdmin: user?.role === 'admin',
    username: user?.username || '',
    role: user?.role || 'viewer',
    loggedIn: !!user?.loggedIn,
  }), [user, login, logout, can]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
