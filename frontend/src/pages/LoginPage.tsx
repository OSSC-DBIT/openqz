import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import type { AuthConfig, Me } from '../api/types';
import { homeFor, useAuth } from '../auth/AuthProvider';
import { GoogleButton } from '../auth/GoogleButton';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { Logo } from '../layouts/AppShell';

export default function LoginPage() {
  const { user, login, loginWithGoogle } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<AuthConfig>('/auth/config'),
    staleTime: Infinity,
  });

  if (user) return <Navigate to={user.must_change_password ? '/change-password' : homeFor(user.role)} replace />;

  const go = (me: Me) => {
    const from = (loc.state as { from?: string } | null)?.from;
    nav(me.must_change_password ? '/change-password' : from ?? homeFor(me.role), { replace: true });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      go(await login(email.trim(), password));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function google(credential: string) {
    setBusy(true);
    setError(null);
    try {
      go(await loginWithGoogle(credential));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const clientId = config.data?.google_client_id;

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-brand-50 via-surface to-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-sm">
          <div>
            <h1 className="text-xl font-bold">Sign in</h1>
            <p className="text-sm text-muted">Use the email your college registered for you.</p>
          </div>

          {clientId && (
            <>
              <GoogleButton clientId={clientId} onCredential={(c) => void google(c)} onError={(m) => setError(new Error(m))} />
              <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
                <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password">
              <Input type="password" aria-label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ErrorText error={error} />
            <Button type="submit" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>
          {config.data?.password_reset_email ? (
            <Link to="/forgot-password" className="block text-center text-sm text-brand-600 hover:underline">
              Forgot your password?
            </Link>
          ) : (
            <p className="text-center text-xs text-muted">Forgot your password? Ask your class teacher or the OpenQZ admin to reset it.</p>
          )}
          <p className="text-center text-xs text-muted">
            New here? Read the{' '}
            <a className="underline" href="/guides/student.html" target="_blank" rel="noreferrer">
              student guide
            </a>{' '}
            or{' '}
            <a className="underline" href="/guides/faculty.html" target="_blank" rel="noreferrer">
              faculty guide
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
