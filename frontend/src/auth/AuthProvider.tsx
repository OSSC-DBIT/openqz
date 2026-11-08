import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionChange, refreshSession, setAccessToken } from '../api/client';
import type { Me, TokenResponse } from '../api/types';

interface AuthState {
  user: Me | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<Me>;
  loginWithGoogle: (credential: string) => Promise<Me>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<Me>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const off = onSessionChange(setUser);
    // Restore the session from the refresh cookie on page load.
    refreshSession().finally(() => setReady(true));
    return () => {
      off();
    };
  }, []);

  const accept = useCallback((t: TokenResponse) => {
    setAccessToken(t.access_token);
    setUser(t.user);
    return t.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) =>
      accept(await api<TokenResponse>('/auth/login', { method: 'POST', json: { email, password } })),
    [accept],
  );

  const loginWithGoogle = useCallback(
    async (credential: string) =>
      accept(await api<TokenResponse>('/auth/google', { method: 'POST', json: { credential } })),
    [accept],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const changePassword = useCallback(
    async (current: string, next: string) =>
      accept(
        await api<TokenResponse>('/auth/change-password', {
          method: 'POST',
          json: { current_password: current, new_password: next },
        }),
      ),
    [accept],
  );

  const value = useMemo(
    () => ({ user, ready, login, loginWithGoogle, logout, changePassword }),
    [user, ready, login, loginWithGoogle, logout, changePassword],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function homeFor(role: Me['role']): string {
  return role === 'admin' ? '/admin' : role === 'faculty' || role === 'club' ? '/faculty' : '/student';
}
