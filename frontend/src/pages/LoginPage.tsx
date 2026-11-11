import { useQuery } from '@tanstack/react-query';
import { QrCode } from 'lucide-react';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../api/client';
import type { AuthConfig, Me } from '../api/types';
import { homeFor, useAuth } from '../auth/AuthProvider';
import { GoogleButton } from '../auth/GoogleButton';
import { isSupportedBrowser } from '../browser';
import { Button, ErrorText, Field, Input, PasswordInput } from '../components/ui';
import { Logo } from '../layouts/AppShell';

// The camera code loads only when someone presses "Scan QR code".
const QrScanner = lazy(() => import('../components/QrScanner').then((m) => ({ default: m.QrScanner })));

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** What a scanned QR code or typed text means: a live game, a room, or just a code. */
export function readJoinCode(text: string): { kind: 'live' | 'room' | 'code'; code: string } | null {
  const t = text.trim();
  const m = /\/(live|join)\/(\d{6})(?:[/?#]|$)/.exec(t);
  if (m) return { kind: m[1] === 'live' ? 'live' : 'room', code: m[2] };
  const bare = t.replace(/\s/g, '');
  return /^\d{6}$/.test(bare) ? { kind: 'code', code: bare } : null;
}

/**
 * For people without an account (or not signed in yet): type the code from the host's screen
 * or scan its QR code. A live game opens at once (guests pick a nickname there, when the host
 * allows guests); a room needs a student account, so we ask them to sign in and go there after.
 */
function GuestJoin({ onRoom }: { onRoom: (code: string) => void }) {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function open(c: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/live/join/${c}`);
      nav(`/live/${c}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) onRoom(c);
      else setMsg(e instanceof Error ? e.message : 'Could not check that code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function scanned(text: string) {
    setScanning(false);
    const hit = readJoinCode(text);
    if (!hit) setMsg('That QR code is not an OpenQZ join code.');
    else if (hit.kind === 'live') nav(`/live/${hit.code}`);
    else if (hit.kind === 'room') onRoom(hit.code);
    else void open(hit.code);
  }

  return (
    <section aria-labelledby="guest-title" className="mt-4 space-y-3 rounded-2xl border border-line bg-card p-6 shadow-sm">
      <div>
        <h2 id="guest-title" className="text-lg font-bold">
          Have a join code?
        </h2>
        <p className="text-sm text-muted">Enter the 6-digit code from the host's screen, or scan the QR code. Guests need no account for live games that allow them.</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (code.length === 6) void open(code);
        }}
      >
        <Input
          inputMode="numeric"
          autoComplete="off"
          aria-label="Join code"
          placeholder="123 456"
          className="text-center text-lg font-bold tracking-widest"
          value={code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}
          onChange={(e) => setCode(digits(e.target.value))}
        />
        <Button type="submit" loading={busy} disabled={code.length !== 6}>
          Join
        </Button>
      </form>
      <Button type="button" variant="secondary" className="w-full" onClick={() => setScanning(true)}>
        <QrCode className="h-4 w-4" aria-hidden /> Scan QR code
      </Button>
      {msg && (
        <p role="alert" className="text-sm font-semibold text-red-600">
          {msg}
        </p>
      )}
      {scanning && (
        <Suspense fallback={null}>
          <QrScanner onResult={scanned} onClose={() => setScanning(false)} />
        </Suspense>
      )}
    </section>
  );
}

/** Shown instead of the sign-in form in a browser other than Chrome, Safari or Edge. */
function UnsupportedBrowser() {
  const [copied, setCopied] = useState(false);
  const link = window.location.origin;
  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-brand-50 via-surface to-surface px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div role="alert" className="space-y-3 rounded-2xl border border-line bg-card p-6 shadow-sm">
          <h1 className="text-xl font-bold">Open OpenQZ in Chrome, Safari or Edge</h1>
          <p className="text-sm text-muted">
            This browser is not supported, so quizzes may not work properly here (timers, full screen, saving answers). Please open OpenQZ in <b>Google Chrome</b>, <b>Safari</b> or <b>Microsoft Edge</b>.
          </p>
          <p className="text-sm text-muted">Opened this from another app (WhatsApp, Instagram)? Use its menu and choose "Open in browser".</p>
          <p className="break-all rounded-xl bg-brand-50 px-3 py-2 font-mono text-sm">{link}</p>
          <Button
            className="w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy the address'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const supported = useState(isSupportedBrowser)[0];
  const { user, login, loginWithGoogle } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // A room code entered before signing in: students go straight to it after sign-in.
  const [room, setRoom] = useState<string | null>(null);
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<AuthConfig>('/auth/config'),
    staleTime: Infinity,
  });

  // Where a signed-in person goes: the room whose code they typed here (students), the page
  // that sent them to sign in, or their home.
  const target = (me: Me) => {
    if (me.must_change_password) return '/change-password';
    if (room && me.role === 'student') return `/join/${room}`;
    return (loc.state as { from?: string } | null)?.from ?? homeFor(me.role);
  };

  if (!supported && !user) return <UnsupportedBrowser />;

  // Also the redirect right after signing in: it renders before `go` below can navigate.
  if (user) return <Navigate to={target(user)} replace />;

  const go = (me: Me) => nav(target(me), { replace: true });

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
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-brand-50 via-surface to-surface px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-sm">
          <div>
            <h1 className="text-xl font-bold">Sign in</h1>
            <p className="text-sm text-muted">Use the email your college registered for you.</p>
          </div>
          {room && (
            <p role="status" className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
              No live game has the code <b>{room}</b>. If it is a <b>room</b> code, sign in with your student account and you will go straight to it.
            </p>
          )}

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
              <PasswordInput label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ErrorText error={error} />
            <Button type="submit" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>
          {config.data?.password_reset_email ? (
            <Link to="/forgot-password" className="block text-center text-sm text-brand-ink hover:underline">
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
        <GuestJoin onRoom={setRoom} />
      </div>
    </div>
  );
}
