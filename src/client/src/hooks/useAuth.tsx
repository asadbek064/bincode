import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../../../shared/api.ts';
import * as api from '../lib/api.ts';
import { readItem, removeItem, writeItem } from '../lib/storage.ts';

const TOKEN_KEY = 'bincode:token';

interface AuthState {
  token: string | null;
  user: User | null;
  /** true until a stored token has been validated against /me */
  checking: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function initialToken(): string | null {
  const token = readItem(TOKEN_KEY);
  // Set synchronously so requests made during the first render are authenticated.
  api.setAuthToken(token);
  return token;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(token !== null);

  const logout = useCallback(() => {
    api.setAuthToken(null);
    removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setChecking(false);
  }, []);

  useEffect(() => {
    api.setUnauthorizedHandler(logout);
    return () => api.setUnauthorizedHandler(null);
  }, [logout]);

  // Validate the stored token once; a 401 triggers logout via the handler above.
  useEffect(() => {
    if (!token || user) return;
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        // Network/server errors keep the token; the next request will retry.
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    api.setAuthToken(res.token);
    writeItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
    setChecking(false);
    return res.user;
  }, []);

  const value = useMemo(
    () => ({ token, user, checking, login, logout }),
    [token, user, checking, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
