import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, setAccessToken } from '../api/client';
import type { TokenResponse } from '../api/types';
import { homeFor } from '../auth/AuthProvider';
import { Button, ErrorText, Field, Input, PasswordInput } from '../components/ui';
import { Logo } from '../layouts/AppShell';
import { passwordProblem } from './ChangePasswordPage';

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-brand-50 via-surface to-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-sm">
          <h1 className="text-xl font-bold">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const send = useMutation({
    mutationFn: () => api<{ message: string }>('/auth/forgot', { method: 'POST', json: { email: email.trim() } }),
  });
  return (
    <Frame title="Forgot your password?">
      {send.isSuccess ? (
        <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          {send.data.message} Check your inbox (and spam). The link works for 30 minutes.
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <p className="text-sm text-muted">Enter the email you sign in with. We will send you a link to choose a new password.</p>
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorText error={send.error} />
          <Button type="submit" className="w-full" loading={send.isPending}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/login" className="block text-center text-sm text-brand-ink hover:underline">
        Back to sign in
      </Link>
    </Frame>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const problem = pw ? passwordProblem(pw) : null;
  const mismatch = confirm.length > 0 && confirm !== pw;
  const reset = useMutation({
    mutationFn: () => api<TokenResponse>('/auth/reset', { method: 'POST', json: { token, new_password: pw } }),
    onSuccess: (t) => {
      setAccessToken(t.access_token);
      // full reload so the auth provider picks up the new session cookie
      window.location.assign(homeFor(t.user.role));
    },
  });
  if (!token) {
    return (
      <Frame title="Reset link missing">
        <p className="text-sm text-muted">Open the link from the email again, or ask for a new one.</p>
        <Button className="w-full" onClick={() => nav('/forgot-password')}>
          Request a new link
        </Button>
      </Frame>
    );
  }
  return (
    <Frame title="Choose a new password">
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!problem && !mismatch) reset.mutate();
        }}
      >
        <Field label="New password" hint={problem ?? '8+ characters with upper, lower case and a digit.'}>
          <PasswordInput label="New password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password" hint={mismatch ? 'Passwords do not match.' : undefined}>
          <PasswordInput label="Confirm new password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ErrorText error={reset.error} />
        <Button type="submit" className="w-full" loading={reset.isPending} disabled={!!problem || mismatch || !confirm}>
          Save password and sign in
        </Button>
      </form>
      <Link to="/forgot-password" className="block text-center text-sm text-brand-ink hover:underline">
        Link expired? Get a new one
      </Link>
    </Frame>
  );
}
