import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Clock, ListChecks, User } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { AttemptState, RoomPreview } from '../api/types';
import { KindCover } from '../components/pieces';
import { KIND_LABEL, fmtSeconds } from '../components/quiz';
import { Button } from '../components/ui';
import { Logo } from '../layouts/AppShell';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
const pretty = (v: string) => (v.length > 3 ? `${v.slice(0, 3)} ${v.slice(3)}` : v);

/** Enter a join code, see what it is, join and start. */
export default function JoinPage() {
  const { code: fromUrl } = useParams();
  const nav = useNavigate();
  const [code, setCode] = useState(digits(fromUrl ?? ''));
  const preview = useMutation({ mutationFn: (c: string) => api<RoomPreview>(`/join/${c}`) });
  const go = useMutation({
    mutationFn: async () => {
      const j = await api<{ assignment_id: string }>('/join', { method: 'POST', json: { code } });
      void document.documentElement.requestFullscreen?.().catch(() => {});
      return api<AttemptState>(`/me/assignments/${j.assignment_id}/start`, { method: 'POST' });
    },
    onSuccess: (s) => nav(`/play/${s.attempt_id}`),
  });

  useEffect(() => {
    if (fromUrl && digits(fromUrl).length === 6) preview.mutate(digits(fromUrl));
    // only on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) preview.mutate(code);
  };
  const p = preview.data;
  const err = (preview.error || go.error) as Error | null;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-br from-[#2a1a6e] via-[#46239e] to-[#7b3fe4] text-white">
      <header className="flex items-center justify-between px-4 py-3">
        <Link to="/student" className="flex items-center gap-1 text-sm text-white/80 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> My activities
        </Link>
        <Logo light />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-md">
          {!p ? (
            <form onSubmit={submit} className="rounded-3xl bg-white p-6 text-ink shadow-2xl">
              <h1 className="text-center text-2xl font-extrabold">Join an activity</h1>
              <p className="mt-1 text-center text-sm text-muted">Enter the 6-digit code from your teacher or club</p>
              <input
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                aria-label="Join code"
                placeholder="123 456"
                value={pretty(code)}
                onChange={(e) => setCode(digits(e.target.value))}
                className="mt-5 w-full rounded-2xl border-2 border-line bg-surface py-4 text-center text-4xl font-extrabold tracking-[0.2em] outline-none focus:border-brand-500"
              />
              {err && (
                <p role="alert" className="mt-3 text-center text-sm font-semibold text-red-600">
                  {err.message}
                </p>
              )}
              <Button type="submit" className="mt-4 w-full !py-3.5 text-base" loading={preview.isPending} disabled={code.length !== 6}>
                Join
              </Button>
            </form>
          ) : (
            <div className="overflow-hidden rounded-3xl bg-white text-ink shadow-2xl">
              <KindCover kind={p.kind} className="h-32" />
              <div className="space-y-3 p-6">
                <div className="text-xs font-bold uppercase text-brand-600">{KIND_LABEL[p.kind]}</div>
                <h1 className="text-2xl font-extrabold">{p.title}</h1>
                <ul className="space-y-1.5 text-sm text-muted">
                  {p.host && (
                    <li className="flex items-center gap-2">
                      <User className="h-4 w-4" aria-hidden /> Hosted by {p.host}
                    </li>
                  )}
                  <li className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4" aria-hidden /> {p.question_count} questions
                  </li>
                  {p.time_limit_seconds && (
                    <li className="flex items-center gap-2">
                      <Clock className="h-4 w-4" aria-hidden /> {fmtSeconds(p.time_limit_seconds)} in total
                    </li>
                  )}
                  {p.due_at && <li>Closes {new Date(p.due_at).toLocaleString()}</li>}
                </ul>
                {!p.open && !p.joined && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">This room is not accepting players right now.</p>}
                {err && (
                  <p role="alert" className="text-sm font-semibold text-red-600">
                    {err.message}
                  </p>
                )}
                <Button className="w-full !py-3.5 text-base" loading={go.isPending} disabled={!p.open && !p.joined} onClick={() => go.mutate()}>
                  {p.joined ? 'Continue' : 'Join and start'}
                </Button>
                <button type="button" onClick={() => preview.reset()} className="w-full text-center text-sm text-muted hover:text-ink">
                  Use a different code
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
