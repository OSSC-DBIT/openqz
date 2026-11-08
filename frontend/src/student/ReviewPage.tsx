import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError, api } from '../api/client';
import type { AttemptState, Review } from '../api/types';
import { ResponseView } from '../components/ResponseView';
import { Badge, Button, Card, ErrorText, Spinner } from '../components/ui';
import { AuthImage } from '../components/quiz';

const REASON: Record<string, string> = {
  timer: 'Time ran out, so your answers were submitted automatically.',
  deadline: 'The deadline passed, so your answers were submitted automatically.',
  violations: 'You left the quiz too many times, so it was submitted automatically.',
};

/**
 * Shown after a violations auto-submit. Checks every few seconds whether the
 * teacher has unblocked the attempt, and offers to continue when they have.
 */
function BlockedNotice({ attemptId }: { attemptId: string }) {
  const nav = useNavigate();
  const s = useQuery({
    queryKey: ['attempt-state', attemptId],
    queryFn: () => api<AttemptState>(`/attempts/${attemptId}`),
    refetchInterval: (q) => (q.state.data?.status === 'in_progress' ? false : 5000),
  });
  if (s.data?.status === 'in_progress') {
    return (
      <div role="status" className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
        <div className="font-bold">Your teacher let you back in.</div>
        <p className="text-sm">Your answers are kept and your warnings start again from 0.</p>
        <Button className="mt-3" onClick={() => nav(`/play/${attemptId}`, { replace: true })}>
          Continue the quiz
        </Button>
      </div>
    );
  }
  return (
    <p className="mx-auto mt-4 max-w-md rounded-2xl bg-white/10 p-3 text-sm text-white/85" aria-live="polite">
      If this was a mistake, ask your teacher to <b>unblock</b> you. Keep this page open: a <b>Continue</b> button appears here as soon as they do.
    </p>
  );
}

/** Accuracy ring for the end-of-quiz summary. */
function Ring({ pct }: { pct: number | null }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const color = v >= 80 ? '#34d399' : v >= 50 ? '#fbbf24' : '#f87171';
  return (
    <div className="relative h-36 w-36" role="img" aria-label={`Accuracy ${pct ?? 0} percent`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center" aria-hidden>
        <div>
          <div className="text-3xl font-extrabold">{pct ?? '-'}%</div>
          <div className="text-xs text-white/70">accuracy</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: string | number; tone?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-3">
      <div className={`flex items-center justify-center gap-1 text-xl font-extrabold ${tone ?? ''}`}>
        {icon}
        {value}
      </div>
      <div className="text-xs text-white/70">{label}</div>
    </div>
  );
}

export default function ReviewPage() {
  const { attemptId } = useParams();
  const [params] = useSearchParams();
  const r = useQuery({ queryKey: ['review', attemptId], queryFn: () => api<Review>(`/attempts/${attemptId}/review`) });
  const d = r.data;
  // Reopened by the teacher (unblocked): go back to the quiz.
  if (r.error instanceof ApiError && r.error.status === 409) return <Navigate to={`/play/${attemptId}`} replace />;
  if (r.isLoading || !d) return r.error ? <ErrorText error={r.error} /> : <Spinner />;
  const reason = params.get('reason') ?? (d.submit_reason !== 'manual' ? d.submit_reason : null);
  const pct = d.score !== null && Number(d.max_score) > 0 ? Math.round((Number(d.score) / Number(d.max_score)) * 100) : null;
  const correct = d.items.filter((i) => i.correct === true).length;
  const wrong = d.items.filter((i) => i.correct === false).length;

  return (
    <div className="mx-auto max-w-3xl">
      <section className="mb-6 overflow-hidden rounded-3xl bg-[#15122b] p-6 text-center text-white shadow-lg sm:p-8">
        <h1 className="text-2xl font-extrabold">Submitted</h1>
        <p className="text-sm text-white/70">{d.items.length} questions</p>
        {reason && REASON[reason] && <p className="mt-2 text-sm font-semibold text-amber-200">{REASON[reason]}</p>}
        {d.submit_reason === 'violations' && attemptId && <BlockedNotice attemptId={attemptId} />}
        {d.scores_visible ? (
          <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-10">
            <Ring pct={pct} />
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <Stat label="marks obtained" value={`${Number(d.score)} / ${Number(d.max_score)}`} />
              <Stat label="correct" value={correct} tone="text-emerald-300" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} />
              <Stat label="incorrect" value={wrong} tone="text-red-300" icon={<XCircle className="h-4 w-4" aria-hidden />} />
            </div>
          </div>
        ) : (
          <p className="mt-4 text-white/80">Your teacher will release the marks later.</p>
        )}
        {d.scores_visible && d.needs_manual && <p className="mt-4 text-sm text-white/70">Marks so far: some answers are still being graded.</p>}
        <Link to="/student">
          <span className="mt-6 inline-block rounded-xl bg-white px-5 py-2.5 font-extrabold text-[#15122b] shadow-[inset_0_-4px_0_rgba(0,0,0,0.15)] hover:bg-white/90">Back to my activities</span>
        </Link>
      </section>

      {(d.answers_visible || d.scores_visible) && (
        <div className="space-y-3">
          {d.items.map((it) => (
            <Card key={it.index}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold">
                  {it.index + 1}. {it.question.stem}
                </div>
                {it.pending ? (
                  <Badge tone="amber">
                    <Clock className="mr-1 h-3 w-3" /> being graded
                  </Badge>
                ) : it.score !== undefined && it.score !== null ? (
                  <Badge tone={it.correct ? 'green' : Number(it.score) > 0 ? 'amber' : 'red'}>
                    {Number(it.score)} / {Number(it.marks)}
                  </Badge>
                ) : null}
              </div>
              {it.question.stem_image_id && <AuthImage id={it.question.stem_image_id} className="mt-2 max-h-40 rounded-lg" />}
              <div className="mt-2 text-sm">
                <ResponseView
                  type={it.question.type}
                  response={it.response}
                  options={it.question.options}
                  keyChoices={d.answers_visible ? it.key?.choices : undefined}
                  keyBlanks={d.answers_visible ? it.key?.blanks : undefined}
                />
              </div>
              {it.rubric && (
                <ul className="mt-2 space-y-0.5 text-sm" aria-label="Marks by criterion">
                  {it.rubric.map((c) => (
                    <li key={c.id} className="flex justify-between">
                      <span>{c.criterion}</span>
                      <span className="text-muted">
                        {c.score === null ? '-' : Number(c.score)} / {Number(c.max)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {it.explanation && <p className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-sm">{it.explanation}</p>}
              {it.feedback && <p className="mt-2 text-sm text-muted">Teacher: {it.feedback}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
