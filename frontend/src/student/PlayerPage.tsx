import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Flame, Maximize, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, api } from '../api/client';
import type { AttemptState, Feedback, PlayQuestion } from '../api/types';
import { AuthImage, TILE_COLORS, fmtClock } from '../components/quiz';
import { Button, Spinner, cx } from '../components/ui';
import { clearIntegrityFlag, useIntegrity, violationText } from './useIntegrity';

type Resp = Record<string, unknown>;

/** True while the page is in full screen (kept in sync with the browser). */
function useIsFullscreen() {
  const [fs, setFs] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return fs;
}

/**
 * Covers the questions until the student enters full screen. Browsers only allow full
 * screen after a tap, so the student presses the button. Skipped where the browser has
 * no full screen at all (iPhone).
 */
function FullscreenGate() {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="fs-title" className="fixed inset-0 z-40 grid place-items-center bg-[#15122b] p-6 text-center text-white">
      <div className="max-w-md">
        <Maximize className="mx-auto h-12 w-12 text-brand-200" aria-hidden />
        <h2 id="fs-title" className="mt-4 text-2xl font-extrabold">
          Full screen is required
        </h2>
        <p className="mt-2 text-white/80">Your teacher requires full screen for this activity. The questions appear as soon as you are in full screen. Leaving full screen counts as a warning.</p>
        <button
          autoFocus
          className="mt-6 rounded-xl bg-white px-6 py-3 text-lg font-extrabold text-[#15122b] shadow-[inset_0_-4px_0_rgba(0,0,0,0.15)] hover:bg-white/90"
          onClick={() =>
            void document.documentElement.requestFullscreen().catch(() => setErr('Your browser did not allow full screen. Try again, or use another browser.'))
          }
        >
          Enter full screen
        </button>
        {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
      </div>
    </div>
  );
}

function useNow(offsetMs: number) {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetMs), 250);
    return () => clearInterval(t);
  }, [offsetMs]);
  return now;
}

export default function PlayerPage() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const [state, setState] = useState<AttemptState | null>(null);
  const [q, setQ] = useState<PlayQuestion | null>(null);
  const [resp, setResp] = useState<Resp | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ text: string; count: number; max: number } | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streak, setStreak] = useState(0);
  const [offset, setOffset] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useNow(offset);
  const isFs = useIsFullscreen();

  const finish = useCallback(
    (reason?: string) => {
      if (attemptId) clearIntegrityFlag(attemptId);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      nav(`/student/review/${attemptId}${reason ? `?reason=${reason}` : ''}`, { replace: true });
    },
    [attemptId, nav],
  );

  const handleErr = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.code === 'submitted') return finish();
      setError(e instanceof Error ? e.message : 'Something went wrong');
    },
    [finish],
  );

  const loadQuestion = useCallback(
    async (index: number) => {
      try {
        const data = await api<PlayQuestion>(`/attempts/${attemptId}/questions/${index}`);
        setOffset(Date.parse(data.server_now) - Date.now());
        setQ(data);
        setResp(data.response);
        setFeedback(data.feedback);
        setError(null);
        setState((s) => (s ? { ...s, current_index: index } : s));
      } catch (e) {
        handleErr(e);
      }
    },
    [attemptId, handleErr],
  );

  // initial load
  useEffect(() => {
    api<AttemptState>(`/attempts/${attemptId}`)
      .then((s) => {
        if (s.status === 'submitted') return finish();
        setOffset(Date.parse(s.server_now) - Date.now());
        setState(s);
        void loadQuestion(s.current_index);
      })
      .catch(handleErr);
  }, [attemptId, finish, handleErr, loadQuestion]);

  useIntegrity(attemptId, !!state && state.status === 'in_progress' && state.activity_kind !== 'flashcards', (kind, r) => {
    setState((s) => (s ? { ...s, violations: r.violations } : s));
    if (r.submitted) return finish('violations');
    setWarning({ text: violationText(kind), count: r.violations, max: r.max });
  });

  const save = useCallback(
    async (response: Resp, final: boolean) => {
      if (!q) return;
      try {
        const r = await api<{ locked: boolean; feedback: Feedback | null }>(`/attempts/${attemptId}/answers/${q.question.id}`, {
          method: 'PUT',
          json: { response, final },
        });
        setState((s) => (s && !s.answered.includes(q.index) ? { ...s, answered: [...s.answered, q.index] } : s));
        if (r.feedback) {
          setFeedback(r.feedback);
          const fb = r.feedback;
          setStreak((n) => (fb.correct ? n + 1 : 0));
        }
        if (r.locked) setQ((cur) => (cur ? { ...cur, locked: true } : cur));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'locked') setQ((cur) => (cur ? { ...cur, locked: true } : cur));
        else handleErr(e);
      }
    },
    [attemptId, q, handleErr],
  );

  const total = state?.total ?? 0;
  const index = q?.index ?? 0;
  const isLast = index >= total - 1;

  const submitAll = useCallback(async () => {
    setBusy(true);
    try {
      if (saveTimer.current && resp) {
        clearTimeout(saveTimer.current);
        await save(resp, false);
      }
      await api(`/attempts/${attemptId}/submit`, { method: 'POST' });
      finish();
    } catch (e) {
      handleErr(e);
    } finally {
      setBusy(false);
    }
  }, [attemptId, finish, handleErr, resp, save]);

  const goto = useCallback(
    async (i: number) => {
      if (saveTimer.current && resp && q && !q.locked) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        await save(resp, false);
      }
      if (i >= total) return setConfirmSubmit(true);
      await loadQuestion(i);
    },
    [loadQuestion, q, resp, save, total],
  );

  // activity deadline: let the server auto-submit, then go to the summary
  const deadline = state?.deadline_at ? Date.parse(state.deadline_at) : null;
  useEffect(() => {
    if (deadline && now >= deadline + 1000) {
      api<AttemptState>(`/attempts/${attemptId}`)
        .then((s) => (s.status === 'submitted' ? finish('timer') : undefined))
        .catch(() => {});
    }
  }, [deadline, now, attemptId, finish]);

  // question timer: lock and auto-advance when it runs out
  const qDeadline = q?.question_deadline ? Date.parse(q.question_deadline) : null;
  const qLimit = q?.question.time_limit_seconds ?? null;
  const advanced = useRef<number | null>(null);
  useEffect(() => {
    if (!q || !qDeadline || advanced.current === q.index) return;
    if (now >= qDeadline) {
      advanced.current = q.index;
      setQ((cur) => (cur ? { ...cur, locked: true } : cur));
      const t = setTimeout(() => void goto(q.index + 1), feedback ? 2500 : 1200);
      return () => clearTimeout(t);
    }
  }, [now, qDeadline, q, goto, feedback]);

  const choose = (patch: Resp, finalNow: boolean) => {
    if (!q || q.locked || feedback) return;
    const next = { ...(resp ?? {}), ...patch };
    setResp(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (finalNow) void save(next, state?.instant_feedback ?? false);
    // Taps on tiles save at once (nothing is lost if the attempt is auto-submitted a moment
    // later); typing is debounced.
    else if (!('text' in patch) && !('blanks' in patch)) void save(next, false);
    else saveTimer.current = setTimeout(() => void save(next, false), 1200);
  };

  // Keyboard: 1-8 pick an answer tile, Enter goes on. Ignored while typing in a box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q || confirmSubmit || warning) return;
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      const n = Number(e.key);
      if (n >= 1 && n <= 8) {
        const tile = document.querySelector<HTMLButtonElement>(`[data-option-index="${n - 1}"]`);
        if (tile && !tile.disabled) {
          e.preventDefault();
          tile.click();
        }
      } else if (e.key === 'Enter' && (feedback || q.locked || !state?.instant_feedback)) {
        e.preventDefault();
        void (q.index >= (state?.total ?? 0) - 1 ? setConfirmSubmit(true) : goto(q.index + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, feedback, state, confirmSubmit, warning, goto]);

  const unanswered = useMemo(() => (state ? total - state.answered.length : 0), [state, total]);

  if (error && !q) return <FullScreenMsg text={error} />;
  if (!state || !q) return <FullScreenMsg text={<Spinner />} />;

  const gated = state.require_fullscreen && state.status === 'in_progress' && document.fullscreenEnabled && !isFs;
  if (state.activity_kind === 'flashcards') {
    return (
      <>
        <Flashcards q={q} total={total} onGoto={goto} onFinish={submitAll} busy={busy} />
        {gated && <FullscreenGate />}
      </>
    );
  }

  const t = q.question;
  const instant = state.instant_feedback && !['open_ended', 'justify'].includes(t.type) && state.activity_kind !== 'poll';
  const awaitingInstant = instant && !feedback && !q.locked;
  // A week-long deadline is not a countdown; show the clock only when it matters.
  const timeLeft = deadline && deadline - now < 3 * 3600_000 ? deadline - now : null;
  const qLeft = qDeadline ? qDeadline - now : null;

  const answeredPct = (state.answered.length / Math.max(1, total)) * 100;
  const qRunning = !!qLimit && qLeft !== null && !q.locked && !feedback;
  return (
    <div className="flex min-h-dvh select-none flex-col bg-[#15122b] text-white [-webkit-touch-callout:none]" onContextMenu={(e) => e.preventDefault()}>
      {/* top strip: question timer while it runs (green, amber, red), otherwise overall progress */}
      {qRunning ? (
        <div className="h-2 w-full bg-white/10" role="progressbar" aria-label="Time left for this question" aria-valuemin={0} aria-valuemax={qLimit ?? 0} aria-valuenow={Math.max(0, Math.ceil((qLeft ?? 0) / 1000))}>
          <div
            className={cx('h-full rounded-r-full transition-[width] duration-200', (qLeft ?? 0) < 5000 ? 'bg-red-500' : (qLeft ?? 0) < (qLimit ?? 0) * 400 ? 'bg-amber-400' : 'bg-emerald-400')}
            style={{ width: `${Math.max(0, Math.min(100, ((qLeft ?? 0) / ((qLimit ?? 1) * 1000)) * 100))}%` }}
          />
        </div>
      ) : (
        <div className="h-2 w-full bg-white/10" aria-hidden>
          <div className="h-full bg-brand-500 transition-[width]" style={{ width: `${answeredPct}%` }} />
        </div>
      )}

      <header className="flex items-center gap-2 px-3 py-3 sm:px-5">
        <span className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold tabular-nums">
          {index + 1}/{total}
        </span>
        <span className="hidden truncate text-sm font-semibold text-white/70 sm:block">{state.activity_title}</span>
        <div className="ml-auto flex items-center gap-2">
          {streak >= 2 && (
            <span className="flex items-center gap-1 rounded-lg bg-orange-500/20 px-2.5 py-1.5 text-sm font-bold text-orange-200" aria-label={`Streak: ${streak} correct in a row`}>
              <Flame className="h-4 w-4" aria-hidden /> {streak}
            </span>
          )}
          {state.max_violations > 0 && state.violations > 0 && (
            <span className="rounded-lg bg-red-500/25 px-2.5 py-1.5 text-xs font-bold text-red-100">
              {state.violations}/{state.max_violations} warnings
            </span>
          )}
          {timeLeft !== null && (
            <span className={cx('flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-bold tabular-nums', timeLeft < 60000 ? 'bg-red-600' : 'bg-white/10')}>
              <Clock className="h-4 w-4" aria-hidden /> {fmtClock(timeLeft)}
            </span>
          )}
          {qRunning && (
            <span className={cx('min-w-12 rounded-lg px-2.5 py-1.5 text-center text-sm font-extrabold tabular-nums', (qLeft ?? 0) < 5000 ? 'bg-red-600' : 'bg-white/10')} aria-hidden>
              {Math.max(0, Math.ceil((qLeft ?? 0) / 1000))}s
            </span>
          )}
          {document.fullscreenEnabled && !document.fullscreenElement && (
            <button className="rounded-lg bg-white/10 p-2 hover:bg-white/20" title="Full screen" aria-label="Full screen" onClick={() => void document.documentElement.requestFullscreen().catch(() => {})}>
              <Maximize className="h-4 w-4" />
            </button>
          )}
          <button className="rounded-lg bg-white px-3.5 py-1.5 text-sm font-bold text-[#15122b] shadow-[inset_0_-3px_0_rgba(0,0,0,0.15)] hover:bg-white/90" onClick={() => setConfirmSubmit(true)}>
            Submit
          </button>
        </div>
      </header>

      <div className="sr-only" aria-live="polite">
        {qRunning && (qLeft ?? 0) > 0 && (qLeft ?? 0) <= 10_000 ? `${Math.ceil((qLeft ?? 0) / 1000)} seconds left` : ''}
        {timeLeft !== null && timeLeft > 0 && timeLeft <= 60_000 ? 'Less than one minute left for the quiz' : ''}
      </div>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 pb-28 sm:px-5" aria-label={`Question ${index + 1} of ${total}`}>
        {/* question card: top half */}
        <div className="mb-3 flex min-h-[28vh] flex-1 flex-col items-center justify-center rounded-2xl bg-[#241f42] p-5 text-center shadow-[inset_0_-4px_0_rgba(0,0,0,0.25)] sm:p-8">
          {t.stem_image_id && <AuthImage id={t.stem_image_id} className="mb-4 max-h-56 rounded-xl" />}
          <h1 className="whitespace-pre-wrap text-xl font-bold leading-snug sm:text-3xl">{t.stem}</h1>
          {t.type === 'multi_select' && (
            <div className="mt-3 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">{t.select_count ? `Select ${t.select_count} answers` : 'Select all correct answers'}</div>
          )}
        </div>

        {/* answers: bottom half */}
        <Answers q={q} resp={resp} feedback={feedback} disabled={q.locked || !!feedback} onChoose={choose} instant={instant} />

        {/* question palette (free navigation only) */}
        {!state.linear && total > 1 && (
          <nav aria-label="Questions" className="mt-4 flex flex-wrap justify-center gap-1.5">
            {Array.from({ length: total }, (_, i) => (
              <button
                key={i}
                onClick={() => void goto(i)}
                aria-label={`Question ${i + 1}${state.answered.includes(i) ? ', answered' : ''}`}
                aria-current={i === index ? 'step' : undefined}
                className={cx('h-8 w-8 rounded-lg text-sm font-bold', i === index ? 'bg-white text-[#15122b]' : state.answered.includes(i) ? 'bg-brand-500 text-white' : 'bg-white/10 text-white/80')}
              >
                {i + 1}
              </button>
            ))}
          </nav>
        )}
      </main>

      {/* bottom bar: becomes the green / red feedback banner after an answer */}
      <div
        role={feedback ? 'status' : undefined}
        aria-live={feedback ? 'assertive' : undefined}
        className={cx(
          'fixed inset-x-0 bottom-0 z-30 px-3 py-3 sm:px-5',
          feedback
            ? feedback.correct
              ? 'bg-emerald-700'
              : feedback.score && Number(feedback.score) > 0
                ? 'bg-amber-700'
                : 'bg-red-700'
            : 'border-t border-white/10 bg-[#15122b]/95 backdrop-blur',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          {feedback ? (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {feedback.correct ? <CheckCircle2 className="h-8 w-8 shrink-0" aria-hidden /> : <XCircle className="h-8 w-8 shrink-0" aria-hidden />}
              <div className="min-w-0">
                <div className="text-lg font-extrabold">
                  {feedback.correct ? 'Correct!' : feedback.score && Number(feedback.score) > 0 ? `Partly correct (${Number(feedback.score)} / ${Number(feedback.marks)})` : 'Incorrect'}
                  {feedback.correct && Number(feedback.marks) > 0 && (
                    <span className="ml-2 text-sm font-bold text-white/90">
                      +{Number(feedback.score ?? feedback.marks)} {Number(feedback.score ?? feedback.marks) === 1 ? 'mark' : 'marks'}
                    </span>
                  )}
                </div>
                {feedback.explanation && <div className="line-clamp-2 text-sm text-white/90">{feedback.explanation}</div>}
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1 text-sm text-white/70">
              {error ? <span className="text-red-300">{error}</span> : q.locked ? (qLeft !== null && qLeft <= 0 ? "Time's up for this question." : 'Answer saved.') : ''}
            </div>
          )}
          {!state.linear && index > 0 && (
            <button className="flex items-center gap-1 rounded-xl bg-white/15 px-4 py-2.5 font-bold hover:bg-white/25" onClick={() => void goto(index - 1)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          )}
          {awaitingInstant && ['multi_select', 'fill_blank'].includes(t.type) && (
            <button className="rounded-xl bg-white px-5 py-2.5 font-extrabold text-[#15122b] shadow-[inset_0_-4px_0_rgba(0,0,0,0.15)] disabled:opacity-50" onClick={() => resp && void save(resp, true)} disabled={!resp}>
              Submit answer
            </button>
          )}
          {/* With instant feedback, MCQ/True-False submit on tap; Next appears after the feedback. */}
          {!awaitingInstant && (
            <button className="flex items-center gap-1 rounded-xl bg-white px-5 py-2.5 font-extrabold text-[#15122b] shadow-[inset_0_-4px_0_rgba(0,0,0,0.15)] hover:bg-white/90" onClick={() => void (isLast ? setConfirmSubmit(true) : goto(index + 1))}>
              {isLast ? 'Finish' : 'Next'} <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {gated && <FullscreenGate />}
      {warning && (
        <Overlay>
          <h2 className="text-lg font-bold text-amber-600">
            Warning {warning.count} of {warning.max || '-'}
          </h2>
          <p className="mt-2 text-ink">{warning.text}</p>
          <p className="mt-2 text-sm text-muted">
            {warning.max ? `After ${warning.max} warnings your attempt is submitted automatically.` : 'This has been recorded for your teacher.'}
          </p>
          <Button className="mt-4 w-full" onClick={() => setWarning(null)}>
            Return to the quiz
          </Button>
        </Overlay>
      )}
      {confirmSubmit && (
        <Overlay>
          <h2 className="text-lg font-bold text-ink">Submit your answers?</h2>
          <p className="mt-2 text-muted">{unanswered > 0 ? `${unanswered} question${unanswered > 1 ? 's are' : ' is'} unanswered.` : 'All questions answered.'} You cannot change answers after submitting.</p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmSubmit(false)}>
              Keep working
            </Button>
            <Button className="flex-1" loading={busy} onClick={() => void submitAll()}>
              Submit
            </Button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Answers({
  q,
  resp,
  feedback,
  disabled,
  instant,
  onChoose,
}: {
  q: PlayQuestion;
  resp: Resp | null;
  feedback: Feedback | null;
  disabled: boolean;
  instant: boolean;
  onChoose: (patch: Resp, finalNow: boolean) => void;
}) {
  const t = q.question;
  const keyIds = new Set(feedback?.key.choices ?? []);
  const chosen = new Set<string>([...((resp?.choices as string[]) ?? []), ...(resp?.choice ? [String(resp.choice)] : [])]);

  if (t.type === 'fill_blank') {
    const n = t.blank_count ?? 1;
    const vals = (resp?.blanks as string[] | undefined) ?? Array(n).fill('');
    return (
      <div className="space-y-3">
        {Array.from({ length: n }, (_, i) => (
          <div key={i}>
            <input
              className="w-full select-text rounded-2xl bg-white px-4 py-3 text-lg text-ink outline-none disabled:opacity-80"
              placeholder={`Blank ${i + 1}`}
              aria-label={`Blank ${i + 1}`}
              value={vals[i] ?? ''}
              disabled={disabled}
              autoCapitalize="off"
              autoComplete="off"
              onChange={(e) => {
                const next = [...vals];
                next[i] = e.target.value;
                onChoose({ blanks: next }, false);
              }}
            />
            {feedback?.key.blanks?.[i] !== undefined && <div className="mt-1 text-sm text-white/80">Answer: {feedback.key.blanks[i]}</div>}
          </div>
        ))}
      </div>
    );
  }

  const optionGrid = t.options.length > 0 && (
    <div role="group" aria-label={t.type === 'multi_select' ? 'Choose all that apply' : 'Choose one answer'} className={cx('grid gap-2 sm:gap-3', t.options.length === 2 ? 'sm:grid-cols-2' : t.options.length === 3 ? 'sm:grid-cols-3' : t.options.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-5')}>
      {t.options.map((o, i) => {
        const picked = chosen.has(o.id);
        const right = feedback && keyIds.has(o.id);
        const wrong = feedback && picked && !keyIds.has(o.id);
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            aria-pressed={picked}
            aria-label={`Option ${i + 1}: ${o.text || 'image'}${right ? ', correct answer' : ''}`}
            data-option-index={i}
            onClick={() => {
              if (t.type === 'multi_select') {
                const next = new Set(chosen);
                if (next.has(o.id)) next.delete(o.id);
                else next.add(o.id);
                onChoose({ choices: [...next] }, false);
              } else if (t.type === 'justify') {
                onChoose({ choice: o.id }, false);
              } else {
                onChoose({ choice: o.id }, instant);
              }
            }}
            className={cx(
              'relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl p-4 text-center text-xl font-bold shadow-[inset_0_-6px_0_rgba(0,0,0,0.22)] transition-transform enabled:hover:-translate-y-0.5 enabled:active:translate-y-0.5 sm:min-h-[28vh]',
              picked && !feedback && 'outline outline-4 outline-offset-2 outline-white',
              right && 'outline outline-4 outline-offset-2 outline-emerald-300',
              wrong && 'opacity-60',
              feedback && !right && !picked && 'opacity-30',
            )}
            style={{ background: TILE_COLORS[i % TILE_COLORS.length] }}
          >
            {o.image_id && <AuthImage id={o.image_id} className="max-h-28 rounded-lg" />}
            <span>{o.text}</span>
            <span className="absolute left-2.5 top-2.5 hidden h-6 w-6 place-items-center rounded-md bg-black/20 text-xs sm:grid" aria-hidden>
              {i + 1}
            </span>
            {t.type === 'multi_select' ? (
              <span className={cx('absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-md border-2 border-white', picked && 'bg-white')} aria-hidden>
                {picked && <CheckCircle2 className="h-4 w-4" style={{ color: TILE_COLORS[i % TILE_COLORS.length] }} />}
              </span>
            ) : (
              picked && <CheckCircle2 className="absolute right-2.5 top-2.5 h-6 w-6" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );

  const textArea = (t.type === 'open_ended' || t.type === 'justify') && (
    <textarea
      rows={t.type === 'justify' ? 3 : 6}
      className="mt-3 w-full select-text rounded-2xl bg-white p-4 text-ink outline-none disabled:opacity-80"
      placeholder={t.type === 'justify' ? 'Explain why you chose this answer' : 'Type your answer'}
      aria-label={t.type === 'justify' ? 'Your justification' : 'Your answer'}
      value={String(resp?.text ?? '')}
      disabled={disabled}
      onChange={(e) => onChoose({ text: e.target.value }, false)}
    />
  );

  return (
    <>
      {optionGrid}
      {textArea}
    </>
  );
}

function Flashcards({ q, total, onGoto, onFinish, busy }: { q: PlayQuestion; total: number; onGoto: (i: number) => void; onFinish: () => void; busy: boolean }) {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => setFlipped(false), [q.index]);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#1e1640] p-4 text-white">
      <div className="text-sm text-white/70">
        Card {q.index + 1} of {total}
      </div>
      <button
        onClick={() => setFlipped((f) => !f)}
        className="flex min-h-[45vh] w-full max-w-xl flex-col items-center justify-center rounded-3xl bg-white p-8 text-center text-2xl font-semibold text-ink shadow-2xl"
      >
        {!flipped && q.question.stem_image_id && <AuthImage id={q.question.stem_image_id} className="mb-3 max-h-48 rounded-xl" />}
        <span className="whitespace-pre-wrap">{flipped ? q.question.back : q.question.stem}</span>
        <span className="mt-4 text-xs font-normal text-muted">{flipped ? 'Back' : 'Tap to flip'}</span>
      </button>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={q.index === 0} onClick={() => onGoto(q.index - 1)}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        {q.index < total - 1 ? (
          <Button onClick={() => onGoto(q.index + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button loading={busy} onClick={onFinish}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function FullScreenMsg({ text }: { text: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-[#1e1640] p-6 text-center text-white">{text}</div>;
}
