import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Clock, Crown, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { TILE_COLORS } from '../components/quiz';
import { cx } from '../components/ui';
import { ordinal, playerApi, useServerClock, type PlayerState } from './api';

/** Removed by the host, not a player of this game, or no such game: retrying cannot help. */
function isFatal(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}

/** A player's phone: only the coloured answer tiles; the question is on the big screen. */
export default function LivePlayPage() {
  const { gameId = '' } = useParams();
  const { user } = useAuth();
  const st = useQuery({
    queryKey: ['live-play', gameId],
    queryFn: () => playerApi<PlayerState>(gameId, `/live/play/${gameId}`),
    // Keep asking through a network blip; stop only when the game ended or we are out of it.
    refetchInterval: (q) => (q.state.data?.status === 'ended' || isFatal(q.state.error) ? false : q.state.error ? 2000 : 1000),
    retry: false,
  });
  const s = st.data;
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedFor, setPickedFor] = useState(-1);
  const send = useMutation({
    mutationFn: (v: { index: number; response: { choice?: string; choices?: string[] } }) =>
      playerApi(gameId, `/live/play/${gameId}/answer`, { method: 'POST', json: v }),
    onSettled: () => void st.refetch(),
  });
  const now = useServerClock(s?.server_now, s?.status === 'question');

  // A failed poll with the game still on screen is a blip: keep the last state and retry.
  if (st.error && (isFatal(st.error) || !s)) {
    const e = st.error as ApiError;
    return (
      <Full>
        <p className="text-xl font-bold">{e.code === 'removed' ? 'The host removed you from this game.' : e.message}</p>
        <Link to="/live" className="mt-4 inline-block rounded-xl bg-white px-5 py-2.5 font-bold text-[#2a1b6e]">
          Join a game
        </Link>
      </Full>
    );
  }
  if (!s) return <Full>Loading...</Full>;

  const header = (
    <div className="flex items-center justify-between px-4 py-3 text-sm font-bold">
      <span className="truncate">{s.me.nickname}</span>
      <span className="rounded-lg bg-white/15 px-2.5 py-1 tabular-nums">{s.me.points} pts</span>
    </div>
  );

  if (s.status === 'lobby')
    return (
      <Full header={header}>
        <Check className="mx-auto h-14 w-14 rounded-full bg-emerald-500 p-3" aria-hidden />
        <h1 className="mt-4 text-2xl font-extrabold">You're in!</h1>
        <p className="mt-2 text-white/90">See your name on the screen. The game starts soon.</p>
      </Full>
    );

  if (s.status === 'ended') {
    const rank = s.me.rank ?? 0;
    return (
      <Full header={header}>
        {rank === 1 && <Crown className="mx-auto h-14 w-14 text-amber-300" aria-hidden />}
        <h1 className="mt-2 text-3xl font-extrabold">{rank ? `${ordinal(rank)} place` : 'Game over'}</h1>
        <p className="mt-1 text-white/90">
          {s.me.points} points{s.me.marks !== undefined ? ` | ${Number(s.me.marks)} marks` : ''}
          {s.me.of ? ` | ${s.me.of} players` : ''}
        </p>
        {s.podium && (
          <ol className="mx-auto mt-6 max-w-xs space-y-2 text-left">
            {s.podium.map((r) => (
              <li key={r.rank} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-2">
                <span className="font-extrabold">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate font-bold">{r.nickname}</span>
                <span className="tabular-nums">{r.points}</span>
              </li>
            ))}
          </ol>
        )}
        <Link to={user ? '/' : '/live'} className="mt-6 inline-block rounded-xl bg-white px-5 py-2.5 font-bold text-[#2a1b6e]">
          {user ? 'Back home' : 'Play another game'}
        </Link>
      </Full>
    );
  }

  const q = s.question;
  if (!q) return <Full header={header}>Waiting for the host...</Full>;

  if (s.status === 'leaderboard')
    return (
      <Full header={header}>
        <div className="text-6xl font-extrabold">{s.me.rank ? ordinal(s.me.rank) : '-'}</div>
        <p className="mt-2 text-white/90">of {s.me.of} | look at the big screen</p>
      </Full>
    );

  if (s.status === 'reveal') {
    const a = s.my_answer;
    return (
      <Full header={header} tone={a?.correct ? 'good' : a ? 'bad' : 'none'}>
        {a ? a.correct ? <Check className="mx-auto h-16 w-16" aria-hidden /> : <X className="mx-auto h-16 w-16" aria-hidden /> : <Clock className="mx-auto h-16 w-16" aria-hidden />}
        <h1 className="mt-3 text-3xl font-extrabold">{a ? (a.correct ? 'Correct!' : 'Not this time') : 'No answer'}</h1>
        {a && <p className="mt-1 text-xl font-bold">+{a.points ?? 0} points</p>}
      </Full>
    );
  }

  // question
  const t = now();
  const starts = new Date(q.starts_at).getTime();
  const ends = new Date(q.ends_at).getTime();
  if (t < starts)
    return (
      <Full header={header}>
        <p className="text-white/90">Question {q.index + 1} of {s.total}</p>
        <div className="mt-2 text-7xl font-extrabold">{Math.max(1, Math.ceil((starts - t) / 1000))}</div>
        <p className="mt-2 font-semibold">Get ready: the question is on the big screen</p>
      </Full>
    );
  // "locked in" only for the question this phone just answered, not for the next one
  if (s.my_answer || (send.isSuccess && send.variables?.index === q.index))
    return (
      <Full header={header}>
        <Loader2 className="mx-auto h-12 w-12 animate-spin" aria-hidden />
        <h1 className="mt-3 text-2xl font-extrabold">Answer locked in</h1>
        <p className="mt-1 text-white/90">Waiting for the others...</p>
      </Full>
    );
  if (t > ends + 1000)
    return (
      <Full header={header}>
        <Clock className="mx-auto h-12 w-12" aria-hidden />
        <h1 className="mt-3 text-2xl font-extrabold">Time's up</h1>
      </Full>
    );

  const multi = q.type === 'multi_select';
  const sel = pickedFor === q.index ? picked : [];
  const toggle = (id: string) => {
    setPickedFor(q.index);
    setPicked(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  };
  const left = Math.max(0, Math.ceil((ends - t) / 1000));
  return (
    <div className="flex min-h-dvh flex-col bg-[#15122b] text-white">
      <div className="flex items-center justify-between px-4 py-3 text-sm font-bold">
        <span>
          {q.index + 1} / {s.total}
        </span>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-lg font-extrabold text-[#15122b]" aria-label={`${left} seconds left`}>
          {left}
        </span>
        <span className="tabular-nums">{s.me.points} pts</span>
      </div>
      {multi && <p className="px-4 pb-2 text-center text-sm font-semibold text-white/90">{q.select_count ? `Pick ${q.select_count}, then Submit` : 'Pick all that apply, then Submit'}</p>}
      <div className={cx('grid flex-1 gap-3 p-3', q.options.length > 2 ? 'grid-cols-2' : 'grid-cols-1')} role="group" aria-label={multi ? 'Choose all that apply' : 'Choose one answer'}>
        {q.options.map((o, i) => {
          const on = sel.includes(o.id);
          return (
            <button
              key={o.id}
              disabled={send.isPending}
              aria-pressed={multi ? on : undefined}
              onClick={() => (multi ? toggle(o.id) : send.mutate({ index: q.index, response: { choice: o.id } }))}
              className={cx(
                'flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center text-xl font-extrabold shadow-[inset_0_-6px_0_rgba(0,0,0,0.22)] active:translate-y-0.5',
                on && 'outline outline-4 outline-offset-2 outline-white',
              )}
              style={{ background: TILE_COLORS[i % TILE_COLORS.length] }}
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-black/20 text-base" aria-hidden>
                {i + 1}
              </span>
              <span className="break-words">
                <span className="sr-only">Answer {i + 1}: </span>
                {o.text}
              </span>
            </button>
          );
        })}
      </div>
      {multi && (
        <div className="p-3 pt-0">
          <button
            className="w-full rounded-2xl bg-white py-4 text-lg font-extrabold text-[#15122b] disabled:opacity-50"
            disabled={!sel.length || send.isPending}
            onClick={() => send.mutate({ index: q.index, response: { choices: sel } })}
          >
            Submit
          </button>
        </div>
      )}
      {send.error && send.variables?.index === q.index && <p className="px-4 pb-3 text-center text-sm font-semibold text-amber-200">{(send.error as Error).message}</p>}
    </div>
  );
}

function Full({ children, header, tone = 'none' }: { children: React.ReactNode; header?: React.ReactNode; tone?: 'good' | 'bad' | 'none' }) {
  return (
    <div className={cx('flex min-h-dvh flex-col text-white', tone === 'good' ? 'bg-emerald-600' : tone === 'bad' ? 'bg-rose-600' : 'bg-gradient-to-br from-[#2a1a6e] via-[#46239e] to-[#7b3fe4]')}>
      {header}
      <div className="grid flex-1 place-items-center p-6 text-center" aria-live="polite">
        <div>{children}</div>
      </div>
    </div>
  );
}
