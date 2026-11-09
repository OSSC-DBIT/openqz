import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, User } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui';
import { Logo } from '../layouts/AppShell';
import { setPlayerToken, type LivePreview } from './api';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** Join a live game: the code, then (for guests, when allowed) a nickname. No account needed. */
export default function LiveJoinPage() {
  const { code: fromUrl } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState(digits(fromUrl ?? ''));
  const [nick, setNick] = useState('');
  const preview = useMutation({ mutationFn: (c: string) => api<LivePreview>(`/live/join/${c}`) });
  const join = useMutation({
    mutationFn: () => api<{ game_id: string; player_token?: string }>('/live/join', { method: 'POST', json: { code, nickname: user ? null : nick } }),
    onSuccess: (r) => {
      if (r.player_token) setPlayerToken(r.game_id, r.player_token);
      nav(`/live/play/${r.game_id}`);
    },
  });

  useEffect(() => {
    if (fromUrl && digits(fromUrl).length === 6) preview.mutate(digits(fromUrl));
    // only on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = preview.data;
  const err = (preview.error ?? join.error) as ApiError | null;
  const needSignIn = p && !user && !p.allow_guests;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-br from-[#2a1a6e] via-[#46239e] to-[#7b3fe4] px-4 py-5 text-white">
      <div className="flex items-center justify-between">
        <Link to={user ? '/' : '/login'} className="flex items-center gap-1 text-sm font-semibold text-white/85 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> {user ? 'Home' : 'Sign in'}
        </Link>
        <Logo light />
      </div>
      <div className="grid flex-1 place-items-center">
        <div className="w-full max-w-sm rounded-3xl bg-card p-6 text-ink shadow-2xl">
          {!p ? (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (code.length === 6) preview.mutate(code);
              }}
            >
              <h1 className="text-center text-2xl font-extrabold">Join a live game</h1>
              <p className="mt-1 text-center text-sm text-muted">Enter the code on the big screen</p>
              <input
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                aria-label="Game code"
                placeholder="123 456"
                value={code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}
                onChange={(e) => setCode(digits(e.target.value))}
                className="mt-5 w-full rounded-2xl border-2 border-line bg-surface py-4 text-center text-4xl font-extrabold tracking-[0.2em] outline-none placeholder:font-semibold placeholder:text-muted/40 focus:border-brand-500"
              />
              {err && (
                <p role="alert" className="mt-3 text-center text-sm font-semibold text-red-600 dark:text-red-400">
                  {err.message}
                </p>
              )}
              <Button type="submit" className="mt-4 w-full !py-3.5 text-base" loading={preview.isPending} disabled={code.length !== 6}>
                Enter
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                join.mutate();
              }}
              className="space-y-4"
            >
              <div className="text-center">
                <div className="text-xs font-bold uppercase tracking-wide text-brand-ink">Live game</div>
                <h1 className="mt-1 text-2xl font-extrabold">{p.title}</h1>
                <p className="mt-1 text-sm text-muted">
                  {p.host ? `Hosted by ${p.host} | ` : ''}
                  {p.questions} questions
                </p>
              </div>
              {needSignIn ? (
                <>
                  <p className="text-center text-sm">This game is for signed-in students.</p>
                  <Link to="/login" state={{ from: `/live/${code}` }} className="block rounded-xl bg-brand-600 py-3 text-center font-bold text-white">
                    Sign in to join
                  </Link>
                </>
              ) : user ? (
                <p className="flex items-center justify-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm">
                  <User className="h-4 w-4" aria-hidden /> Joining as <b>{user.full_name}</b>
                </p>
              ) : (
                <label className="block">
                  <span className="text-sm font-semibold">Your nickname</span>
                  <input
                    autoFocus
                    maxLength={20}
                    value={nick}
                    onChange={(e) => setNick(e.target.value)}
                    placeholder="e.g. Quiz Ninja"
                    className="mt-1 w-full rounded-xl border-2 border-line bg-surface px-3 py-3 text-lg font-bold outline-none focus:border-brand-500"
                  />
                  <span className="mt-1 block text-xs text-muted">Shown on the big screen. Keep it friendly.</span>
                </label>
              )}
              {err && (
                <p role="alert" className="text-center text-sm font-semibold text-red-600 dark:text-red-400">
                  {err.message}
                </p>
              )}
              {!needSignIn && (
                <Button type="submit" className="w-full !py-3.5 text-base" loading={join.isPending} disabled={!p.open || (!user && nick.trim().length < 2)}>
                  {p.open ? 'Join' : 'Closed to new players'}
                </Button>
              )}
              <button type="button" onClick={() => preview.reset()} className="w-full text-center text-sm text-muted hover:text-ink">
                Use a different code
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
