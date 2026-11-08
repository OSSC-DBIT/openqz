import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { homeFor, useAuth } from '../auth/AuthProvider';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { Logo } from '../layouts/AppShell';

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'At least 8 characters.';
  if (pw.toLowerCase() === pw || pw.toUpperCase() === pw) return 'Mix upper and lower case letters.';
  if (!/\d/.test(pw)) return 'Include at least one digit.';
  return null;
}

export default function ChangePasswordPage() {
  const { user, ready, changePassword, logout } = useAuth();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (ready && !user) return <Navigate to="/login" replace />;
  if (!user) return null;

  const problem = next ? passwordProblem(next) : null;
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const me = await changePassword(current, next);
      nav(homeFor(me.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-sm">
          <div>
            <h1 className="text-xl font-bold">{user.must_change_password ? 'Set your password' : 'Change password'}</h1>
            <p className="text-sm text-muted">
              {user.must_change_password
                ? 'You are using a temporary password. Choose a new one to continue.'
                : 'Choose a new password.'}
            </p>
            {user.google_linked && !user.must_change_password && (
              <p className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-muted">
                You can keep using Continue with Google. If you never had a password of your own, ask the admin to reset it to get a temporary one first.
              </p>
            )}
          </div>
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password" hint={problem ?? '8+ characters with upper, lower case and a digit.'}>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="Confirm new password" hint={mismatch ? 'Passwords do not match.' : undefined}>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" loading={busy} disabled={!!problem || mismatch || !confirm} className="w-full">
            Save password
          </Button>
          <button type="button" onClick={() => void logout()} className="w-full text-center text-sm text-muted hover:text-ink">
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}
