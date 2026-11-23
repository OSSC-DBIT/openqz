import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, onSessionChange, refreshSession, setAccessToken } from '../api/client';
import type { Me, TokenResponse } from '../api/types';

interface AuthState {
  user: Me | null;
  ready: boolean;
  /** `privacyAccepted`: the "I agree to the privacy policy" tick on the sign-in page. */
  login: (email: string, password: string, privacyAccepted?: boolean) => Promise<Me>;
  loginWithGoogle: (credential: string, privacyAccepted?: boolean) => Promise<Me>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<Me>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  const lastId = useRef<string | null>(null);

  // Cached answers belong to one person. On a shared lab computer the next person to sign in
  // must never see the previous one's activities or marks, so the cache is emptied whenever
  // the signed-in user changes or signs out.
  const apply = useCallback(
    (me: Me | null) => {
      if (lastId.current !== null && lastId.current !== (me?.id ?? null)) qc.clear();
      lastId.current = me?.id ?? null;
      setUser(me);
    },
    [qc],
  );

  useEffect(() => {
    const off = onSessionChange(apply);
    // Restore the session from the refresh cookie on page load.
    refreshSession().finally(() => setReady(true));
    return () => {
      off();
    };
  }, [apply]);

  const accept = useCallback((t: TokenResponse) => {
    setAccessToken(t.access_token);
    apply(t.user);
    return t.user;
  }, [apply]);

  const login = useCallback(
    async (email: string, password: string, privacyAccepted = false) =>
      accept(await api<TokenResponse>('/auth/login', { method: 'POST', json: { email, password, privacy_accepted: privacyAccepted } })),
    [accept],
  );

  const loginWithGoogle = useCallback(
    async (credential: string, privacyAccepted = false) =>
      accept(await api<TokenResponse>('/auth/google', { method: 'POST', json: { credential, privacy_accepted: privacyAccepted } })),
    [accept],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      apply(null);
    }
  }, [apply]);

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
