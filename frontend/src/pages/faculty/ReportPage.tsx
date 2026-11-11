import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileSpreadsheet, LockOpen, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, downloadFile } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { DeleteForever } from '../../components/DeleteForever';
import type { GradingItem, Report, ReportStudent, RubricItem } from '../../api/types';
import { Badge, Button, Card, EmptyState, ErrorText, Input, Modal, PageHeader, Spinner, Table, Td, cx } from '../../components/ui';
import { KIND_LABEL, TYPE_LABEL, fromLocalInput, toLocalInput } from '../../components/quiz';
import { ResponseView } from '../../components/ResponseView';
import { RoomBanner } from './RoomBanner';

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <div className="text-xs font-semibold uppercase text-muted">{label}</div>
      <div className="mt-1 text-2xl font-extrabold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </Card>
  );
}

const tone = (acc: number | null) => (acc === null ? 'neutral' : acc >= 70 ? 'green' : acc >= 40 ? 'amber' : 'red');

export default function ReportPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'students' | 'questions' | 'grading'>('overview');
  const [viewAttempt, setViewAttempt] = useState<string | null>(null);
  const [editDue, setEditDue] = useState(false);
  const [forever, setForever] = useState(false);
  const { user } = useAuth();
  const nav = useNavigate();
  const [unblock, setUnblock] = useState<ReportStudent | null>(null);
  const rep = useQuery({ queryKey: ['report', id], queryFn: () => api<Report>(`/activity-assignments/${id}/results`), refetchInterval: (q) => (q.state.data?.assignment.is_room ? 5000 : 20000) });
  const queue = useQuery({ queryKey: ['grading', id], queryFn: () => api<GradingItem[]>(`/activity-assignments/${id}/grading`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['report', id] });
    void qc.invalidateQueries({ queryKey: ['grading', id] });
  };
  const release = useMutation({ mutationFn: () => api(`/activity-assignments/${id}/release`, { method: 'POST' }), onSuccess: refresh });
  const csv = useMutation({ mutationFn: () => downloadFile(`/activity-assignments/${id}/results.csv`, `openqz-results-${id?.slice(0, 8)}.csv`) });
  const xlsx = useMutation({ mutationFn: () => downloadFile(`/activity-assignments/${id}/results.xlsx`, `openqz-results-${id?.slice(0, 8)}.xlsx`) });

  const r = rep.data;
  if (rep.isLoading || !r) return rep.error ? <ErrorText error={rep.error} /> : <Spinner />;
  const s = r.summary;
  const asg = r.assignment;

  return (
    <>
      {forever && (
        <DeleteForever
          title={`Delete the results of "${asg.activity_title}"`}
          endpoint={`/admin/data/assignments/${asg.id}/delete`}
          confirmWord={asg.activity_title}
          onClose={() => setForever(false)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['my-assignments'] });
            nav('/faculty/reports');
          }}
        >
          <p className="mt-1">
            This removes this assignment ({asg.target_labels.join(', ') || 'join code only'}) with <b>{s.started} attempts</b> and their marks. The activity and its questions stay.
          </p>
        </DeleteForever>
      )}
      <Link to="/faculty/reports" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> All reports
      </Link>
      <PageHeader
        title={asg.activity_title}
        subtitle={`${KIND_LABEL[asg.activity_kind]} | ${asg.target_labels.join(', ')} | ${asg.due_at ? `due ${new Date(asg.due_at).toLocaleString()}` : 'no deadline'}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditDue(true)}>
              Edit deadline
            </Button>
            <Button variant="secondary" loading={xlsx.isPending} onClick={() => xlsx.mutate()}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button variant="secondary" loading={csv.isPending} onClick={() => csv.mutate()}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            {s.graded && asg.release_mode !== 'immediate' && (
              <Button loading={release.isPending} disabled={!!asg.released_at} onClick={() => release.mutate()}>
                <Send className="h-4 w-4" /> {asg.released_at ? 'Marks released' : 'Release marks'}
              </Button>
            )}
            {user?.role === 'admin' && (
              <Button variant="danger" onClick={() => setForever(true)}>
                <Trash2 className="h-4 w-4" /> Delete results
              </Button>
            )}
          </>
        }
      />
      <ErrorText error={release.error || csv.error || xlsx.error} />

      {asg.is_room && <RoomBanner a={asg} joined={s.assigned} players={r.students.map((p) => p.name)} onChange={refresh} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Completion" value={`${s.completion}%`} sub={`${s.submitted} of ${s.assigned} submitted, ${s.started - s.submitted} in progress`} />
        {s.graded ? (
          <>
            <Tile label="Average marks" value={s.avg_score === null ? '-' : `${Number(s.avg_score)} / ${Number(s.max_score)}`} sub={s.avg_accuracy === null ? undefined : `average accuracy ${s.avg_accuracy}%`} />
            <Tile label="Highest / lowest marks" value={s.high_score === null ? '-' : `${Number(s.high_score)} / ${Number(s.low_score)}`} sub={`out of ${Number(s.max_score)} marks`} />
            <Tile label="To grade" value={s.pending_grading} sub="students with open answers" />
          </>
        ) : (
          <Tile label="Responses" value={s.submitted} />
        )}
      </div>

      <div className="mb-4 mt-6 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {(['overview', 'students', 'questions', ...(s.graded ? ['grading'] : [])] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t as typeof tab)}
            className={cx('-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold capitalize', tab === t ? 'border-brand-600 text-brand-700 dark:text-brand-200' : 'border-transparent text-muted')}
          >
            {t === 'grading' ? `Grading (${queue.data?.length ?? 0})` : t === 'students' ? 'Participants' : t === 'overview' ? 'Overview' : 'Questions'}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewGrid report={r} onView={setViewAttempt} onUnblock={setUnblock} />}

      {tab === 'students' && (
        <Table head={['Student', 'Status', s.graded ? 'Marks obtained' : '', s.graded ? 'Accuracy' : '', 'Flags', '']}>
          {r.students.map((st) => (
            <tr key={st.student_id}>
              <Td>
                <div className="font-semibold">{st.name}</div>
                <div className="font-mono text-xs text-muted">{st.usn}</div>
              </Td>
              <Td>
                <Badge tone={st.status === 'submitted' ? 'green' : st.status === 'in_progress' ? 'amber' : 'neutral'}>{st.status.replace('_', ' ')}</Badge>
              </Td>
              <Td>{s.graded && st.score !== null ? `${Number(st.score)} / ${Number(st.max_score)}` : ''}</Td>
              <Td>{s.graded && st.accuracy !== null && <Badge tone={tone(st.accuracy)}>{st.accuracy}%</Badge>}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {st.needs_manual && <Badge tone="brand">to grade</Badge>}
                  {st.late && <Badge tone="amber">late</Badge>}
                  {st.violations > 0 && <Badge tone="red">{st.violations} violations</Badge>}
                  {st.blocked_attempt_id ? (
                    <Badge tone="red">blocked</Badge>
                  ) : (
                    st.submit_reason && st.submit_reason !== 'manual' && <Badge tone="neutral">auto: {st.submit_reason}</Badge>
                  )}
                  {st.unblocked > 0 && <Badge tone="neutral">unblocked {st.unblocked}x</Badge>}
                </div>
              </Td>
              <Td className="whitespace-nowrap text-right">
                {st.blocked_attempt_id && (
                  <Button variant="secondary" onClick={() => setUnblock(st)}>
                    <LockOpen className="h-4 w-4" /> Unblock
                  </Button>
                )}
                {st.attempt_id && (
                  <Button variant="ghost" onClick={() => setViewAttempt(st.attempt_id)}>
                    View
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {tab === 'questions' && (
        <div className="space-y-3">
          {r.questions.map((q, i) => (
            <Card key={q.question_id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-muted">
                    Q{i + 1} | {TYPE_LABEL[q.type]}
                  </div>
                  <div className="font-semibold">{q.stem}</div>
                </div>
                {q.accuracy !== null && <Badge tone={tone(q.accuracy)}>{q.accuracy}% correct</Badge>}
              </div>
              <div className="mt-2 text-sm text-muted">
                {q.answered} answered{q.avg_score !== null ? ` | avg ${q.avg_score} / ${Number(q.marks)}` : ''}
                {q.pending ? ` | ${q.pending} to grade` : ''}
              </div>
              {q.options.length > 0 && q.answered > 0 && (
                <div className="mt-3 space-y-1.5">
                  {q.options.map((o) => (
                    <div key={o.id} className="text-sm">
                      <div className="flex justify-between">
                        <span>{o.text || '(image)'}</span>
                        <span className="text-muted">{o.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-line">
                        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(o.count / Math.max(1, q.answered)) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === 'grading' && <GradingQueue items={queue.data ?? []} onGraded={refresh} />}

      {unblock?.blocked_attempt_id && (
        <UnblockDialog
          attemptId={unblock.blocked_attempt_id}
          name={unblock.name}
          violations={unblock.violations}
          onClose={() => setUnblock(null)}
          onDone={() => {
            setUnblock(null);
            refresh();
          }}
        />
      )}
      {viewAttempt && <AttemptModal attemptId={viewAttempt} onClose={() => setViewAttempt(null)} onGraded={refresh} />}
      {editDue && <DueDialog id={id!} current={asg.due_at} allowLate={asg.allow_late} onClose={() => setEditDue(false)} onDone={refresh} />}
    </>
  );
}

function GradeForm({
  attemptId,
  questionId,
  marks,
  rubric = [],
  initial,
  onDone,
}: {
  attemptId: string;
  questionId: string;
  marks: string;
  rubric?: RubricItem[];
  initial?: { score: string | null; feedback: string | null; rubric_scores?: Record<string, string> | null };
  onDone: () => void;
}) {
  const [score, setScore] = useState(initial?.score ?? '');
  const [parts, setParts] = useState<Record<string, string>>(initial?.rubric_scores ?? {});
  const [fb, setFb] = useState(initial?.feedback ?? '');
  const total = rubric.reduce((t, r) => t + (Number(parts[r.id ?? '']) || 0), 0);
  const ready = rubric.length ? rubric.every((r) => (parts[r.id ?? ''] ?? '') !== '') : score !== '';
  const save = useMutation({
    mutationFn: () =>
      api(`/activity-assignments/attempts/${attemptId}/answers/${questionId}/grade`, {
        method: 'PUT',
        json: rubric.length
          ? { rubric_scores: Object.fromEntries(rubric.map((r) => [r.id, Number(parts[r.id ?? ''])])), feedback: fb || null }
          : { score: Number(score), feedback: fb || null },
      }),
    onSuccess: onDone,
  });
  return (
    <div className="mt-3 space-y-2">
      {rubric.length > 0 ? (
        <div className="space-y-1.5">
          {rubric.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{r.criterion}</span>
              <Input
                className="!w-20"
                type="number"
                min={0}
                max={Number(r.max)}
                step={0.5}
                value={parts[r.id ?? ''] ?? ''}
                onChange={(e) => setParts({ ...parts, [r.id ?? '']: e.target.value })}
                aria-label={`${r.criterion} marks`}
              />
              <span className="w-12 text-muted">/ {Number(r.max)}</span>
            </div>
          ))}
          <div className="text-right text-sm font-semibold">
            Total {total} / {Number(marks)}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input className="!w-24" type="number" min={0} max={Number(marks)} step={0.5} placeholder="Marks" value={score} onChange={(e) => setScore(e.target.value)} aria-label="Score" />
          <span className="text-sm text-muted">/ {Number(marks)}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-48 flex-1" placeholder="Feedback (optional)" value={fb} onChange={(e) => setFb(e.target.value)} aria-label="Feedback" />
        <Button loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
      <ErrorText error={save.error} />
    </div>
  );
}

function GradingQueue({ items, onGraded }: { items: GradingItem[]; onGraded: () => void }) {
  if (!items.length) return <EmptyState title="Nothing to grade">Open answers appear here after students submit.</EmptyState>;
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <Card key={`${it.attempt_id}-${it.question_id}`}>
          <div className="text-xs text-muted">
            {it.student} ({it.usn}) | {TYPE_LABEL[it.type]}
          </div>
          <div className="font-semibold">{it.stem}</div>
          <div className="mt-2 rounded-xl bg-brand-50 p-3 text-sm">
            <ResponseView type={it.type} response={it.response} options={it.options} />
            {it.choice_correct !== null && <Badge tone={it.choice_correct ? 'green' : 'red'}>{it.choice_correct ? 'correct option' : 'wrong option'}</Badge>}
          </div>
          <GradeForm attemptId={it.attempt_id} questionId={it.question_id} marks={it.marks} rubric={it.rubric} onDone={onGraded} />
        </Card>
      ))}
    </div>
  );
}

interface TeacherItem {
  index: number;
  question: { id: string; type: GradingItem['type']; stem: string; options: GradingItem['options'] };
  explanation: string | null;
  response: Record<string, unknown> | null;
  marks: string;
  auto_score: string | null;
  manual_score: string | null;
  feedback: string | null;
  correct: boolean | null;
  needs_manual: boolean;
  rubric: RubricItem[];
  rubric_scores: Record<string, string> | null;
}

function AttemptModal({ attemptId, onClose, onGraded }: { attemptId: string; onClose: () => void; onGraded: () => void }) {
  const qc = useQueryClient();
  const d = useQuery({
    queryKey: ['attempt-detail', attemptId],
    queryFn: () =>
      api<{ student: { name: string; usn: string }; score: string | null; max_score: string; violations: number; submit_reason: string | null; can_unblock: boolean; unblocked_count: number; items: TeacherItem[] }>(
        `/activity-assignments/attempts/${attemptId}`,
      ),
  });
  const [unblocking, setUnblocking] = useState(false);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['attempt-detail', attemptId] });
    onGraded();
  };
  return (
    <Modal open onClose={onClose} title={d.data ? `${d.data.student.name} (${d.data.student.usn})` : 'Attempt'}>
      {!d.data ? (
        <Spinner />
      ) : (
        <div className="max-h-[70vh] space-y-3 overflow-y-auto">
          <p className="text-sm text-muted">
            Marks obtained {d.data.score === null ? '-' : Number(d.data.score)} / {Number(d.data.max_score)} | {d.data.violations} violations
            {d.data.submit_reason ? ` | submitted: ${d.data.submit_reason}` : ''}
            {d.data.unblocked_count > 0 ? ` | unblocked ${d.data.unblocked_count}x` : ''}
          </p>
          {d.data.can_unblock && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <span>Blocked: submitted automatically after too many warnings.</span>
              <Button variant="secondary" onClick={() => setUnblocking(true)}>
                <LockOpen className="h-4 w-4" /> Unblock
              </Button>
            </div>
          )}
          {unblocking && (
            <UnblockDialog
              attemptId={attemptId}
              name={d.data.student.name}
              violations={d.data.violations}
              onClose={() => setUnblocking(false)}
              onDone={() => {
                setUnblocking(false);
                done();
              }}
            />
          )}
          {d.data.items.map((it) => {
            const final = it.manual_score ?? it.auto_score;
            return (
              <div key={it.question.id} className="rounded-xl border border-line p-3">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-semibold">
                    {it.index + 1}. {it.question.stem}
                  </span>
                  <span className="shrink-0 text-muted">{final === null ? 'to grade' : `${Number(final)} / ${Number(it.marks)}`}</span>
                </div>
                <div className="mt-1 text-sm">
                  <ResponseView type={it.question.type} response={it.response} options={it.question.options} showCorrect />
                </div>
                {it.needs_manual && (
                  <GradeForm
                    attemptId={attemptId}
                    questionId={it.question.id}
                    marks={it.marks}
                    rubric={it.rubric}
                    initial={{ score: it.manual_score, feedback: it.feedback, rubric_scores: it.rubric_scores }}
                    onDone={done}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

const CELL: Record<string, { cls: string; label: string }> = {
  correct: { cls: 'bg-emerald-500', label: 'correct' },
  partial: { cls: 'bg-amber-400', label: 'partly correct' },
  wrong: { cls: 'bg-red-500', label: 'incorrect' },
  pending: { cls: 'bg-blue-500', label: 'to grade' },
  answered: { cls: 'bg-brand-500', label: 'answered' },
  blank: { cls: 'bg-line', label: 'not answered' },
};

/** Wayground-style overview: every student x every question, one coloured square each. */
function OverviewGrid({ report, onView, onUnblock }: { report: Report; onView: (id: string) => void; onUnblock: (s: ReportStudent) => void }) {
  const qs = [...report.questions].sort((a, b) => a.position - b.position);
  const graded = report.summary.graded;
  if (!report.students.length) return <EmptyState title="No participants yet">Students appear here as soon as they start.</EmptyState>;
  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 text-xs text-muted">
        {(graded ? ['correct', 'partial', 'wrong', 'pending', 'blank'] : ['answered', 'blank']).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cx('h-3 w-3 rounded', CELL[k].cls)} aria-hidden /> {CELL[k].label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-2 font-bold">
                Student
              </th>
              {graded && (
                <th scope="col" className="px-3 py-2 font-bold">
                  Marks obtained
                </th>
              )}
              {qs.map((q, i) => (
                <th key={q.question_id} scope="col" className="px-1 py-2 text-center font-bold" title={q.stem}>
                  Q{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.students.map((st) => (
              <tr key={st.student_id} className="hover:bg-brand-50/50">
                <th scope="row" className="sticky left-0 z-10 border-t border-line bg-card px-4 py-2 text-left font-normal">
                  <button type="button" disabled={!st.attempt_id} onClick={() => st.attempt_id && onView(st.attempt_id)} className="text-left disabled:cursor-default">
                    <span className="block font-semibold hover:underline">{st.name}</span>
                    <span className="block text-xs text-muted">{st.status === 'not_started' ? 'not started' : st.status === 'in_progress' ? 'in progress' : st.usn}</span>
                  </button>
                  {st.blocked_attempt_id && (
                    <button type="button" onClick={() => onUnblock(st)} className="mt-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800 hover:bg-red-200 dark:bg-red-950 dark:text-red-200">
                      blocked: unblock
                    </button>
                  )}
                </th>
                {graded && (
                  <td className="whitespace-nowrap border-t border-line px-3 py-2">
                    {st.score !== null ? (
                      <span className="flex items-center gap-2">
                        <span className="font-bold">
                          {Number(st.score)} / {Number(st.max_score)}
                        </span>
                        {st.accuracy !== null && <Badge tone={tone(st.accuracy)}>{st.accuracy}%</Badge>}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                )}
                {qs.map((q, i) => {
                  const state = st.cells?.[q.question_id];
                  const c = state ? CELL[state] : null;
                  return (
                    <td key={q.question_id} className="border-t border-line px-1 py-2 text-center">
                      {c ? (
                        <span className={cx('mx-auto block h-7 w-7 rounded-md', c.cls)} role="img" aria-label={`Q${i + 1}: ${c.label}`} title={`Q${i + 1}: ${c.label}`} />
                      ) : (
                        <span className="mx-auto block h-7 w-7 rounded-md border border-dashed border-line" aria-hidden />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Let a student back into an attempt that was auto-submitted for too many warnings. */
export function UnblockDialog({
  attemptId,
  name,
  violations,
  onClose,
  onDone,
}: {
  attemptId: string;
  name: string;
  violations: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [extra, setExtra] = useState('0');
  const go = useMutation({
    mutationFn: () => api(`/activity-assignments/attempts/${attemptId}/unblock`, { method: 'POST', json: { extra_minutes: Number(extra) || 0 } }),
    onSuccess: onDone,
  });
  return (
    <Modal open onClose={onClose} title={`Unblock ${name}?`}>
      <div className="space-y-3 text-sm">
        <p>
          {name}'s attempt was submitted automatically after {violations} warnings. Unblocking opens it again so they can carry on from where they stopped:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>their answers so far are kept; questions they had not finished open again,</li>
          <li>answers already locked by a question timer or instant feedback stay locked,</li>
          <li>warnings start again from 0 (every warning stays in the integrity log),</li>
          <li>if the activity has a timer or deadline, the time they spent blocked is added back, plus any extra minutes below.</li>
        </ul>
        <label className="flex items-center gap-2">
          <span className="font-semibold">Extra minutes</span>
          <Input type="number" min={0} max={180} value={extra} onChange={(e) => setExtra(e.target.value)} className="w-24" />
        </label>
        <p className="text-muted">They continue with <b>Resume</b> on their home page, or straight away if they are still on the results screen.</p>
        <ErrorText error={go.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={go.isPending} onClick={() => go.mutate()}>
            <LockOpen className="h-4 w-4" /> Unblock
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DueDialog({ id, current, allowLate, onClose, onDone }: { id: string; current: string | null; allowLate: boolean; onClose: () => void; onDone: () => void }) {
  const [due, setDue] = useState(toLocalInput(current));
  const [late, setLate] = useState(allowLate);
  const save = useMutation({
    mutationFn: () => api(`/activity-assignments/${id}`, { method: 'PATCH', json: { due_at: fromLocalInput(due), allow_late: late } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Deadline">
      <div className="space-y-3">
        <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} /> Allow late submissions
        </label>
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
