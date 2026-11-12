import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import type { AttemptState, MyActivity, Section } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Button, EmptyState, ErrorText, Modal, PageHeader, Spinner, cx } from '../../components/ui';
import { KindCover } from '../../components/pieces';
import { KIND_LABEL, fmtSeconds } from '../../components/quiz';
import { enterFullscreen } from '../../student/fullscreen';

function due(a: MyActivity): string {
  if (a.window === 'not_started') return `Opens ${new Date(a.start_at).toLocaleString()}`;
  if (!a.due_at) return 'No deadline';
  const late = a.window === 'late';
  return `${late ? 'Was due' : 'Due'} ${new Date(a.due_at).toLocaleString()}`;
}

function JoinBar() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const d = code.replace(/\D/g, '').slice(0, 6);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (d.length === 6) nav(`/join/${d}`);
      }}
      className="mb-8 rounded-3xl bg-gradient-to-br from-[#2a1a6e] via-[#46239e] to-[#7b3fe4] px-5 py-8 text-center text-white shadow-lg sm:py-10"
    >
      <h2 className="text-xl font-extrabold sm:text-2xl">Got a join code?</h2>
      <p className="mt-1 text-sm text-white/85">Enter the 6-digit code from your teacher or club.</p>
      <div className="mx-auto mt-5 flex max-w-md items-center gap-2 rounded-2xl bg-white p-1.5 shadow-xl">
        <input
          inputMode="numeric"
          aria-label="Join code"
          placeholder="123 456"
          value={d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d}
          onChange={(e) => setCode(e.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-center text-2xl font-extrabold tracking-widest text-[#1d1b2c] outline-none placeholder:font-semibold placeholder:text-[#1d1b2c]/25"
        />
        <button type="submit" disabled={d.length !== 6} className="rounded-xl bg-brand-600 px-5 py-3 font-extrabold text-white shadow-[inset_0_-4px_0_rgba(0,0,0,0.2)] disabled:opacity-50">
          Join
        </button>
      </div>
    </form>
  );
}

export default function StudentHome() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const sections = useQuery({ queryKey: ['me', 'sections'], queryFn: () => api<Section[]>('/me/sections') });
  const acts = useQuery({ queryKey: ['me', 'activities'], queryFn: () => api<{ pending: MyActivity[]; completed: MyActivity[] }>('/me/activities') });
  const start = useMutation({
    mutationFn: (id: string) => api<AttemptState>(`/me/assignments/${id}/start`, { method: 'POST' }),
    onSuccess: (s) => {
      nav(`/play/${s.attempt_id}`);
    },
  });
  const list = acts.data?.[tab] ?? [];
  // The instructions the student is reading; `start` = they pressed Start and must confirm.
  const [reading, setReading] = useState<{ a: MyActivity; start: boolean } | null>(null);
  const begin = (id: string) => {
    enterFullscreen(); // must run inside the click (browsers refuse full screen later)
    start.mutate(id);
  };

  // A scheduled activity opens by itself: refresh the list when the next start time comes.
  const pending = acts.data?.pending;
  const refetch = acts.refetch;
  useEffect(() => {
    const next = (pending ?? [])
      .filter((a) => a.window === 'not_started')
      .map((a) => new Date(a.start_at).getTime() - Date.now())
      .filter((ms) => ms > -60_000)
      .sort((x, y) => x - y)[0];
    if (next === undefined) return;
    const t = setTimeout(() => void refetch(), Math.min(Math.max(next, 0) + 1500, 2_000_000_000));
    return () => clearTimeout(t);
  }, [pending, refetch]);

  return (
    <>
      <PageHeader title={`Hi, ${user?.full_name.split(' ')[0] ?? ''}`} subtitle={user?.username} />
      <JoinBar />
      <div className="mb-4 flex flex-wrap gap-2">
        {sections.data?.map((s) => (
          <span key={s.id} className="rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-700 dark:text-brand-200">
            {s.department_code} Sem {s.semester} {s.name}
          </span>
        ))}
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {(['pending', 'completed'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx('-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold capitalize', tab === t ? 'border-brand-600 text-brand-700 dark:text-brand-200' : 'border-transparent text-muted')}
          >
            {t} ({acts.data?.[t].length ?? 0})
          </button>
        ))}
      </div>
      <ErrorText error={acts.error || start.error} />
      {acts.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState title={tab === 'pending' ? 'Nothing due' : 'Nothing completed yet'}>
          {tab === 'pending' ? 'Quizzes and assignments from your faculty will appear here.' : undefined}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => (
            <div key={a.assignment_id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-sm transition hover:shadow-md">
              <KindCover kind={a.kind} className="h-24">
                <span className="absolute left-3 top-3 rounded-full bg-black/25 px-2 py-0.5 text-xs font-bold text-white">{KIND_LABEL[a.kind]}</span>
                {a.in_progress_attempt_id && <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-brand-700">in progress</span>}
                {a.window === 'not_started' && <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-[#1d1b2c]">not started</span>}
                {a.missed && <span className="absolute right-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">missed</span>}
                {a.window === 'late' && !a.missed && <span className="absolute right-3 top-3 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">late</span>}
              </KindCover>
              <div className="flex flex-1 flex-col p-4">
              <h3 className="font-bold">{a.title}</h3>
              <p className="mt-1 text-sm text-muted">
                {a.question_count} questions{a.time_limit_seconds ? ` | ${fmtSeconds(a.time_limit_seconds)}` : ''}
              </p>
              <p className="text-sm text-muted">{due(a)}</p>
              {a.score !== null && (
                <p className="mt-1 text-sm font-semibold">
                  Marks: {Number(a.score)} / {Number(a.max_score)}
                  {a.pending_grading ? ' (being graded)' : ''}
                </p>
              )}
              <div className="mt-auto flex gap-2 pt-3">
                {a.can_start && (
                  <Button
                    loading={start.isPending && start.variables === a.assignment_id}
                    onClick={() => {
                      // First start with a note from the teacher: read it, then confirm.
                      if (a.instructions && !a.in_progress_attempt_id) setReading({ a, start: true });
                      else begin(a.assignment_id);
                    }}
                  >
                    {a.in_progress_attempt_id ? 'Resume' : 'Start'}
                  </Button>
                )}
                {a.window === 'not_started' && (
                  <Button disabled title={`Opens ${new Date(a.start_at).toLocaleString()}`}>
                    Not started yet
                  </Button>
                )}
                {a.instructions && !a.best_attempt_id && (
                  <Button variant="secondary" onClick={() => setReading({ a, start: false })}>
                    Instructions
                  </Button>
                )}
                {a.best_attempt_id && (
                  <Link to={`/student/review/${a.best_attempt_id}`}>
                    <Button variant="secondary">Review</Button>
                  </Link>
                )}
              </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {reading && (
        <Modal open onClose={() => setReading(null)} title={`Instructions: ${reading.a.title}`}>
          <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-sm">{reading.a.instructions}</p>
          {reading.a.window === 'not_started' && <p className="mt-3 text-sm font-semibold text-muted">Opens {new Date(reading.a.start_at).toLocaleString()}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReading(null)}>
              {reading.start ? 'Not now' : 'Close'}
            </Button>
            {reading.start && (
              <Button
                onClick={() => {
                  begin(reading.a.assignment_id);
                  setReading(null);
                }}
              >
                Start now
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
