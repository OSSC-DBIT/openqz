import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, Hash, Send, Users } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { ActivityKind, Assignment, AssignmentInfo } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { KindCover } from '../../components/pieces';
import { KIND_LABEL } from '../../components/quiz';
import { Card, EmptyState, ErrorText, Spinner } from '../../components/ui';

const KIND_HINT: Record<ActivityKind, string> = {
  quiz: 'Auto-marked, timed',
  assignment: 'Written work you mark',
  poll: 'Opinions, no marks',
  flashcards: 'Self-study cards',
};

function dueLabel(a: AssignmentInfo) {
  if (!a.due_at) return a.is_room ? 'Room, no deadline' : 'No deadline';
  const due = new Date(a.due_at);
  const past = due.getTime() < Date.now();
  const when = due.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return past ? `Closed ${when}` : `Due ${when}`;
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: string | number; hint?: string }) {
  return (
    <Card className="flex flex-col items-start gap-2 !p-4 sm:flex-row sm:items-center sm:gap-4 sm:!p-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:text-brand-200">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-2xl font-extrabold leading-tight">{value}</div>
        <div className="text-sm leading-snug text-muted">
          {label}
          {hint ? ` | ${hint}` : ''}
        </div>
      </div>
    </Card>
  );
}

export default function FacultyHome() {
  const { user } = useAuth();
  const isClub = user?.role === 'club';
  const teaching = useQuery({ queryKey: ['me', 'teaching'], queryFn: () => api<Assignment[]>('/me/teaching'), enabled: !isClub });
  const recent = useQuery({ queryKey: ['my-assignments'], queryFn: () => api<AssignmentInfo[]>('/activity-assignments') });

  const list = recent.data ?? [];
  const open = list.filter((a) => !a.due_at || new Date(a.due_at).getTime() > Date.now()).length;
  const submitted = list.reduce((n, a) => n + a.submitted_count, 0);
  const expected = list.reduce((n, a) => n + a.student_count, 0);
  const classes = new Set((teaching.data ?? []).map((t) => t.section_label)).size;

  return (
    <>
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#2a1b6e] via-brand-700 to-brand-500 p-6 text-white shadow-lg sm:p-8">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/5" aria-hidden />
        <div className="relative">
          <h1 className="text-2xl font-extrabold sm:text-3xl">Hello, {user?.full_name.split(' ')[0] ?? ''}</h1>
          <p className="mt-1 text-white/80">What would you like to create today?</p>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
              <Link
                key={k}
                to={`/faculty/library?create=1&kind=${k}`}
                className="group overflow-hidden rounded-2xl bg-white text-ink shadow-md ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-xl dark:bg-card"
              >
                <KindCover kind={k} className="h-16 sm:h-20" />
                <div className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="font-bold">{KIND_LABEL[k]}</div>
                    <div className="truncate text-xs text-muted">{KIND_HINT[k]}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-ink" aria-hidden />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <ErrorText error={teaching.error || recent.error} />

      <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {!isClub && <Stat icon={Users} label="Classes you teach" value={teaching.isLoading ? '-' : classes} />}
        <Stat icon={Send} label={isClub ? 'Rooms hosted' : 'Assigned'} value={recent.isLoading ? '-' : list.length} />
        <Stat icon={CalendarClock} label="Open now" value={recent.isLoading ? '-' : open} />
        <Stat icon={CheckCircle2} label="Submissions" value={recent.isLoading ? '-' : `${submitted} / ${expected}`} hint={expected ? `${Math.round((submitted / expected) * 100)}%` : undefined} />
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="recent-title" className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="recent-title" className="text-lg font-bold">
              Recently assigned
            </h2>
            <Link to="/faculty/reports" className="text-sm font-semibold text-brand-ink hover:underline">
              All reports
            </Link>
          </div>
          {recent.isLoading ? (
            <Spinner />
          ) : list.length ? (
            <ul className="space-y-3">
              {list.slice(0, 8).map((a) => {
                const pct = a.student_count ? Math.round((a.submitted_count / a.student_count) * 100) : 0;
                return (
                  <li key={a.id}>
                    <Link to={`/faculty/reports/${a.id}`} className="flex items-center gap-4 rounded-2xl border border-line bg-card p-3 shadow-sm transition hover:border-brand-500 hover:shadow-md sm:p-4">
                      <KindCover kind={a.activity_kind} className="hidden h-14 w-20 shrink-0 rounded-xl sm:flex [&_svg]:h-7 [&_svg]:w-7" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-brand-ink">{KIND_LABEL[a.activity_kind]}</span>
                          {a.is_room && a.join_code && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700 dark:text-brand-200">
                              <Hash className="h-3 w-3" aria-hidden />
                              {a.join_code}
                            </span>
                          )}
                        </div>
                        <div className="truncate font-bold">{a.activity_title}</div>
                        <div className="truncate text-sm text-muted">
                          {a.target_labels.length ? a.target_labels.join(', ') : 'Join code only'} | {dueLabel(a)}
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`${a.activity_title}: submitted`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="shrink-0 text-xs font-semibold text-muted">
                            {a.submitted_count}/{a.student_count} submitted
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Nothing assigned yet">Create an activity above, then assign it to your classes or host it as a room.</EmptyState>
          )}
        </section>

        {!isClub && (
          <section aria-labelledby="classes-title" className="min-w-0">
            <h2 id="classes-title" className="mb-3 text-lg font-bold">
              My classes
            </h2>
            {teaching.isLoading ? (
              <Spinner />
            ) : teaching.data?.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {teaching.data.map((t) => (
                  <li key={t.id} className="min-w-0">
                    <Card className="flex items-center gap-3 !p-4">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        <BookOpen className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-bold">{t.subject_name}</div>
                        <div className="truncate text-sm text-muted">
                          <span className="font-mono">{t.subject_code}</span> | {t.section_label}
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No classes yet">Ask the OpenQZ admin to map you to your sections and subjects.</EmptyState>
            )}
          </section>
        )}
      </div>
    </>
  );
}
