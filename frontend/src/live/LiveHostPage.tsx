import { useMutation, useQuery } from '@tanstack/react-query';
import { BarChart3, Check, Crown, Lock, LockOpen, Maximize, Play, SkipForward, Trophy, Users, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { AuthImage, TILE_COLORS } from '../components/quiz';
import { cx } from '../components/ui';
import { Logo } from '../layouts/AppShell';
import { SCORING_LABEL, useServerClock, type BoardRow, type HostView } from './api';

/** The host's screen, made for a projector: lobby, questions, answer counts, leaderboard, podium. */
export default function LiveHostPage() {
  const { gameId } = useParams();
  const game = useQuery({
    queryKey: ['live-host', gameId],
    queryFn: () => api<HostView>(`/live/games/${gameId}`),
    refetchInterval: (q) => (q.state.data?.status === 'ended' ? false : 1000),
  });
  const g = game.data;
  const act = useMutation({
    mutationFn: (action: string) => api<HostView>(`/live/games/${gameId}/${action}`, { method: 'POST' }),
    onSuccess: () => void game.refetch(),
  });
  const remove = useMutation({
    mutationFn: (playerId: string) => api(`/live/games/${gameId}/players/${playerId}`, { method: 'DELETE' }),
    onSuccess: () => void game.refetch(),
  });
  const now = useServerClock(g?.server_now, g?.status === 'question');

  // Time up, or everyone answered: show the answer automatically (once per question).
  const revealedFor = useRef(-1);
  useEffect(() => {
    if (!g || g.status !== 'question' || !g.question || revealedFor.current === g.index) return;
    const timeUp = now() >= new Date(g.question.ends_at).getTime();
    const allIn = g.players.length > 0 && g.answered >= g.players.length;
    if (timeUp || allIn) {
      revealedFor.current = g.index;
      act.mutate('reveal');
    }
  });

  if (game.error) return <Screen>{(game.error as Error).message}</Screen>;
  if (!g) return <Screen>Loading...</Screen>;

  const last = g.index >= g.total - 1;
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-br from-[#1a1240] via-[#2a1b6e] to-[#4a2bb0] text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo light />
          <span className="hidden truncate text-sm font-semibold text-white/85 sm:inline">{g.title}</span>
        </div>
        <div className="flex items-center gap-2">
          {g.status !== 'lobby' && g.status !== 'ended' && (
            <span className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold">
              {g.index + 1} / {g.total}
            </span>
          )}
          <span className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold">
            Code {g.code}
          </span>
          <button className="rounded-lg bg-white/10 p-2 hover:bg-white/20" aria-label="Full screen" title="Full screen" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}>
            <Maximize className="h-4 w-4" />
          </button>
          {g.status !== 'ended' && (
            <button className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold hover:bg-white/20" onClick={() => confirm('End the game for everyone?') && act.mutate('end')}>
              End
            </button>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 pb-6 sm:px-8">
        {g.status === 'lobby' && <Lobby g={g} onStart={() => act.mutate('start')} onLock={() => act.mutate(g.accepting_joins ? 'lock' : 'unlock')} onRemove={(id, nick) => confirm(`Remove ${nick} from the game?`) && remove.mutate(id)} busy={act.isPending} />}
        {(g.status === 'question' || g.status === 'reveal') && g.question && <QuestionView g={g} now={now} onSkip={() => act.mutate('reveal')} onBoard={() => act.mutate('leaderboard')} onNext={() => act.mutate('next')} last={last} />}
        {g.status === 'leaderboard' && <Leaderboard g={g} onNext={() => act.mutate('next')} last={last} />}
        {g.status === 'ended' && <Podium g={g} />}
        {act.error && <p className="mt-3 text-center text-sm text-amber-200">{(act.error as Error).message}</p>}
      </main>
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-[#1a1240] p-6 text-center text-white">{children}</div>;
}

function Lobby({ g, onStart, onLock, onRemove, busy }: { g: HostView; onStart: () => void; onLock: () => void; onRemove: (id: string, nick: string) => void; busy: boolean }) {
  const link = `${window.location.origin}/live/${g.code}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 260, color: { dark: '#1d1b2c', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
        <div className="rounded-3xl bg-white/10 p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-white/85">1. Open</div>
          <div className="mt-1 whitespace-nowrap text-xl font-extrabold lg:text-2xl">{window.location.host}/live</div>
          <div className="mt-2 text-sm text-white/85">{g.allow_guests ? 'Anyone can join with a nickname, or sign in.' : 'Players sign in with their college account.'}</div>
        </div>
        <div className="rounded-3xl bg-white p-5 text-[#1d1b2c]">
          <div className="text-xs font-bold uppercase tracking-wide text-[#6b6880]">2. Enter the code</div>
          <div className="mt-1 text-5xl font-extrabold tracking-[0.15em] lg:text-6xl" aria-label={`Join code ${g.code.split('').join(' ')}`}>
            {g.code.slice(0, 3)} {g.code.slice(3)}
          </div>
        </div>
        {qr && <img src={qr} alt={`QR code for ${link}`} className="mx-auto h-36 w-36 rounded-2xl bg-white p-2 md:h-auto md:w-40" />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-xl font-extrabold">{g.players.length}</span>
          <span className="text-lg font-bold">{g.players.length === 1 ? 'player' : 'players'} joined</span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">{SCORING_LABEL[g.scoring]}</span>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 font-bold hover:bg-white/20" onClick={onLock}>
            {g.accepting_joins ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />} {g.accepting_joins ? 'Stop new joins' : 'Allow joins'}
          </button>
          <button
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-lg font-extrabold text-[#2a1b6e] shadow-[inset_0_-4px_0_rgba(0,0,0,0.15)] disabled:opacity-50"
            disabled={busy || g.players.length === 0}
            onClick={onStart}
          >
            <Play className="h-5 w-5" /> Start
          </button>
        </div>
      </div>

      {g.players.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Players">
          {g.players.map((p) => (
            <li key={p.id} className="animate-[pop_0.25s_ease-out]">
              <button
                className="group flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 font-bold hover:bg-red-500/80"
                title="Remove this player"
                onClick={() => onRemove(p.id, p.nickname)}
              >
                <span className="sr-only">Remove </span>
                {p.nickname}
                {p.guest && <span className="text-xs font-semibold text-white/85">guest</span>}
                <X className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid flex-1 place-items-center text-xl text-white/85">
          <span className="flex items-center gap-2">
            <Users className="h-6 w-6" /> Waiting for players to join...
          </span>
        </div>
      )}
    </div>
  );
}

function QuestionView({ g, now, onSkip, onBoard, onNext, last }: { g: HostView; now: () => number; onSkip: () => void; onBoard: () => void; onNext: () => void; last: boolean }) {
  const q = g.question!;
  const t = now();
  const starts = new Date(q.starts_at).getTime();
  const ends = new Date(q.ends_at).getTime();
  const revealed = g.status === 'reveal';
  const ready = !revealed && t < starts;
  const left = Math.max(0, Math.ceil((ends - Math.max(t, starts)) / 1000));
  const total = Math.max(1, Object.values(g.counts ?? {}).reduce((a, b) => a + b, 0));
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4">
      <div className="relative flex min-h-[30vh] flex-1 flex-col items-center justify-center rounded-3xl bg-white p-6 text-center text-[#1d1b2c] shadow-xl">
        {q.stem_image_id && <AuthImage id={q.stem_image_id} className="mb-4 max-h-56 rounded-xl" />}
        <h1 className="whitespace-pre-wrap text-2xl font-extrabold leading-snug sm:text-4xl 2xl:text-5xl">{q.stem}</h1>
        {ready && (
          <div className="absolute inset-0 grid place-items-center rounded-3xl bg-[#2a1b6e]/95 text-white" aria-live="polite">
            <div>
              <div className="text-lg font-semibold text-white/85">Question {q.index + 1}</div>
              <div className="text-8xl font-extrabold">{Math.max(1, Math.ceil((starts - t) / 1000))}</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-2xl font-extrabold text-[#2a1b6e]" aria-label={revealed ? 'Time is up' : `${left} seconds left`}>
          {revealed ? <Check className="h-8 w-8" /> : left}
        </div>
        <div className="text-center">
          <div className="text-3xl font-extrabold">
            {g.answered} / {g.players.length}
          </div>
          <div className="text-sm text-white/85">answered</div>
        </div>
        <div className="flex gap-2">
          {revealed ? (
            <>
              <button className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 font-bold hover:bg-white/20" onClick={onBoard}>
                <BarChart3 className="h-4 w-4" /> Leaderboard
              </button>
              <button className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 font-extrabold text-[#2a1b6e]" onClick={onNext}>
                {last ? 'Finish' : 'Next'} <SkipForward className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button className="rounded-xl bg-white/10 px-4 py-2.5 font-bold hover:bg-white/20" onClick={onSkip}>
              Show answer
            </button>
          )}
        </div>
      </div>

      <div className={cx('grid gap-3', q.options.length <= 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4')}>
        {q.options.map((o, i) => {
          const n = g.counts?.[o.id] ?? 0;
          return (
            <div
              key={o.id}
              className={cx('relative overflow-hidden rounded-2xl p-5 shadow-[inset_0_-6px_0_rgba(0,0,0,0.22)] transition-opacity', revealed && !o.correct && 'opacity-40')}
              style={{ background: TILE_COLORS[i % TILE_COLORS.length] }}
            >
              {revealed && <div className="absolute inset-y-0 left-0 bg-black/20" style={{ width: `${(n / total) * 100}%` }} aria-hidden />}
              <div className="relative flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/20 font-extrabold">{i + 1}</span>
                <span className="min-w-0 flex-1 break-words text-xl font-bold sm:text-2xl">{o.text}</span>
                {revealed && (
                  <span className="flex items-center gap-1 text-xl font-extrabold">
                    {o.correct && <Check className="h-6 w-6" aria-label="correct answer" />}
                    {n}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BoardList({ rows, fun }: { rows: BoardRow[]; fun: boolean }) {
  return (
    <ol className="space-y-2">
      {rows.map((r) => (
        <li key={r.rank + r.nickname} className={cx('flex items-center gap-4 rounded-2xl px-5 py-3', r.rank === 1 ? 'bg-white text-[#2a1b6e]' : 'bg-white/10')}>
          <span className="w-8 text-2xl font-extrabold">{r.rank}</span>
          <span className="min-w-0 flex-1 truncate text-xl font-bold">
            {r.nickname}
            {r.guest && <span className="ml-2 text-xs font-semibold opacity-80">guest</span>}
          </span>
          {!fun && r.marks !== undefined && <span className="text-sm font-semibold opacity-75">{Number(r.marks)} marks</span>}
          <span className="text-2xl font-extrabold tabular-nums">{r.points}</span>
        </li>
      ))}
    </ol>
  );
}

function Leaderboard({ g, onNext, last }: { g: HostView; onNext: () => void; last: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1">
      <h1 className="mb-5 flex items-center justify-center gap-3 text-3xl font-extrabold">
        <Trophy className="h-8 w-8 text-amber-300" /> Leaderboard
      </h1>
      <BoardList rows={g.leaderboard.slice(0, 5)} fun={g.scoring === 'fun'} />
      <div className="mt-6 flex justify-center">
        <button className="flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-lg font-extrabold text-[#2a1b6e]" onClick={onNext}>
          {last ? 'Finish' : 'Next question'} <SkipForward className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function Podium({ g }: { g: HostView }) {
  const top = g.leaderboard.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const heights = ['h-32', 'h-44', 'h-24'];
  const places = [2, 1, 3];
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-8">
      <h1 className="text-3xl font-extrabold">Final results</h1>
      <div className="flex w-full items-end justify-center gap-3 sm:gap-6">
        {order.map((r, i) =>
          r ? (
            <div key={r.nickname} className="flex w-1/3 max-w-56 flex-col items-center gap-2">
              {places[i] === 1 && <Crown className="h-10 w-10 text-amber-300" aria-hidden />}
              <div className="w-full truncate text-center text-lg font-extrabold sm:text-2xl">{r.nickname}</div>
              <div className="text-sm font-semibold text-white/80">{r.points} points</div>
              <div className={cx('grid w-full place-items-center rounded-t-2xl bg-white/90 text-5xl font-extrabold text-[#2a1b6e]', heights[i])}>{places[i]}</div>
            </div>
          ) : (
            <div key={i} className="w-1/3 max-w-56" />
          ),
        )}
      </div>
      {g.leaderboard.length > 3 && (
        <div className="w-full max-w-2xl">
          <BoardList rows={g.leaderboard.slice(3, 10)} fun={g.scoring === 'fun'} />
        </div>
      )}
      <div className="flex gap-3">
        <Link to={`/faculty/live/${g.id}`} className="rounded-xl bg-white px-5 py-3 font-extrabold text-[#2a1b6e]">
          View results
        </Link>
        <Link to="/faculty/library" className="rounded-xl bg-white/10 px-5 py-3 font-bold hover:bg-white/20">
          Back to library
        </Link>
      </div>
    </div>
  );
}
