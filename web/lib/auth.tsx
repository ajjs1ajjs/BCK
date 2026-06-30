"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api, setTokens, clearTokens, loadTokens } from "./api";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    loadTokens();
    const token = localStorage.getItem("access_token");
    if (token) {
      api
        .me()
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setUser(data);
        })
        .catch(() => clearTokens())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.login(username, password);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Login failed");
    }
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    setUser(data.user);
    router.push("/");
  };

  const logout = () => {
    clearTokens();
    setUser(null);
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
