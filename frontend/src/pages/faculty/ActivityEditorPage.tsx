import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Copy, Eye, GripVertical, Pencil, Plus, Send, Trash2, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { DeleteForever } from '../../components/DeleteForever';
import type { Activity, AssignmentInfo, Question, QuestionData, QuestionType } from '../../api/types';
import { ClassPicker, KindCover, Pill, TYPE_ICON, TypePicker } from '../../components/pieces';
import { Badge, Button, ErrorText, Modal, Select, Spinner, cx } from '../../components/ui';
import { AuthImage, KIND_LABEL, MARK_PRESETS, TILE_COLORS, TYPES_FOR, TYPE_LABEL } from '../../components/quiz';
import { TimerSelect } from '../../components/TimerSelect';
import { AssignDrawer } from './AssignDrawer';
import { useClassOptions } from './LibraryPage';
import { PreviewModal } from './PreviewModal';
import { QuestionEditor, QuestionToolbar, blankQuestion } from './QuestionEditor';

function toData(q: Question): QuestionData {
  const { id: _id, position: _p, ...rest } = q;
  void _id;
  void _p;
  return rest;
}

const asBody = (d: QuestionData) => ({ ...d, marks: Number(d.marks), rubric: (d.rubric ?? []).map((x) => ({ ...x, max: Number(x.max) })) });

/**
 * Full-screen activity editor (no app sidebar), laid out like Wayground's:
 * a top bar with the title and the main actions, a summary panel, and the
 * question cards with timer and marks editable in place.
 */
export default function ActivityEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const act = useQuery({ queryKey: ['activity', id], queryFn: () => api<Activity>(`/activities/${id}`) });
  const classes = useClassOptions();
  const [editing, setEditing] = useState<{ id: string | null; index: number; data: QuestionData } | null>(null);
  const [picker, setPicker] = useState(false);
  const [params] = useSearchParams();
  // ?assign=1 (from the library's Assign button) opens the assign drawer straight away
  const [assigning, setAssigning] = useState(params.get('assign') === '1');
  const [preview, setPreview] = useState(false);
  const [classDlg, setClassDlg] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const a = act.data;
  const { user } = useAuth();
  const [forever, setForever] = useState(false);

  const refresh = (data?: Activity) => {
    if (data) qc.setQueryData(['activity', id], data);
    else void qc.invalidateQueries({ queryKey: ['activity', id] });
    void qc.invalidateQueries({ queryKey: ['activities'] });
  };

  const save = useMutation({
    mutationFn: ({ qid, data }: { qid: string | null; data: QuestionData }) =>
      qid
        ? api<Question>(`/activities/${id}/questions/${qid}`, { method: 'PUT', json: asBody(data) })
        : api<Question>(`/activities/${id}/questions`, { method: 'POST', json: asBody(data) }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const quick = useMutation({
    mutationFn: ({ q, patch }: { q: Question; patch: Partial<QuestionData> }) => api<Question>(`/activities/${id}/questions/${q.id}`, { method: 'PUT', json: asBody({ ...toData(q), ...patch }) }),
    onSuccess: () => refresh(),
  });
  const del = useMutation({ mutationFn: (qid: string) => api(`/activities/${id}/questions/${qid}`, { method: 'DELETE' }), onSuccess: () => refresh() });
  const dupQ = useMutation({ mutationFn: (q: Question) => api(`/activities/${id}/questions`, { method: 'POST', json: asBody(toData(q)) }), onSuccess: () => refresh() });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api<Activity>(`/activities/${id}/order`, { method: 'PUT', json: { question_ids: ids } }), onSuccess: (d) => refresh(d) });
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api<Activity>(`/activities/${id}`, { method: 'PATCH', json: body }), onSuccess: (d) => refresh(d) });
  const duplicate = useMutation({
    mutationFn: () => api<Activity>(`/activities/${id}/duplicate`, { method: 'POST' }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['activities'] });
      nav(`/faculty/activities/${d.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/activities/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activities'] });
      nav('/faculty/library');
    },
  });

  if (act.isLoading || !a) return <div className="grid min-h-dvh place-items-center">{act.error ? <ErrorText error={act.error} /> : <Spinner />}</div>;
  const graded = a.kind === 'quiz' || a.kind === 'assignment';
  const timed = a.kind !== 'flashcards';

  const drop = (to: number) => {
    if (dragFrom === null || dragFrom === to) return;
    const ids = a.questions.map((x) => x.id);
    const [moved] = ids.splice(dragFrom, 1);
    ids.splice(to, 0, moved);
    setDragFrom(null);
    reorder.mutate(ids);
  };
  const move = (i: number, d: -1 | 1) => {
    const ids = a.questions.map((x) => x.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };
  const addQuestion = () =>
    TYPES_FOR[a.kind].length === 1 ? setEditing({ id: null, index: a.questions.length, data: blankQuestion(TYPES_FOR[a.kind][0], a.kind) }) : setPicker(true);

  return (
    <div className="min-h-dvh bg-surface">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-card">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
          <Link to="/faculty/library" className="rounded-lg p-2 text-muted hover:bg-brand-50 hover:text-ink" aria-label="Back to library" title="Back to library">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <KindCover kind={a.kind} className="hidden h-9 w-9 shrink-0 rounded-lg sm:block" />
          <input
            key={a.title}
            defaultValue={a.title}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-base font-bold outline-none hover:border-line focus:border-brand-500 sm:text-lg"
            onBlur={(e) => e.target.value.trim() && e.target.value !== a.title && patch.mutate({ title: e.target.value.trim() })}
            aria-label="Title"
          />
          <Badge tone={a.status === 'published' ? 'green' : 'amber'}>{a.status === 'published' ? 'Published' : 'Draft'}</Badge>
          <div className="ml-1 flex items-center gap-2">
            <Button variant="secondary" disabled={!a.questions.length} onClick={() => setPreview(true)} title="Preview as a student">
              <Eye className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Preview</span>
            </Button>
            <Button onClick={() => setAssigning(true)} disabled={!a.questions.length}>
              <Send className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Assign or host</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-3 py-5 sm:px-6 lg:grid-cols-[300px_1fr]">
        {/* summary panel */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
            <KindCover kind={a.kind} className="h-28" />
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Badge tone="brand">{KIND_LABEL[a.kind]}</Badge>
              </div>
              <p className="text-sm font-semibold">
                {a.question_count} questions{graded ? ` | ${Number(a.total_marks)} marks` : ''}
              </p>
              {classes.data?.can_use_sections !== false && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
                    <Users className="h-3.5 w-3.5" aria-hidden /> Classes
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.class_labels.length ? a.class_labels.map((l) => <Pill key={l}>{l}</Pill>) : <span className="text-sm text-muted">No class chosen</span>}
                  </div>
                  <button type="button" onClick={() => setClassDlg(true)} className="mt-2 text-sm font-semibold text-brand-ink hover:underline dark:text-brand-200">
                    Edit classes
                  </button>
                </div>
              )}
            </div>
            <div className="flex border-t border-line">
              <button type="button" className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-muted hover:bg-brand-50 hover:text-ink" onClick={() => duplicate.mutate()}>
                <Copy className="h-4 w-4" /> Duplicate
              </button>
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-1.5 border-l border-line py-2.5 text-sm font-semibold text-muted hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                onClick={() => confirm('Delete this activity? Activities with student attempts are archived instead.') && remove.mutate()}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
            {user?.role === 'admin' && (
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
                onClick={() => setForever(true)}
              >
                <Trash2 className="h-4 w-4" /> Delete for good (admin)
              </button>
            )}
          </div>
          {timed && a.questions.length > 0 && <BulkBar activity={a} onDone={(d) => refresh(d)} />}
        </aside>

        {/* questions */}
        <section aria-label="Questions">
          <div className="mb-3 flex items-center gap-3">
            <h1 className="text-lg font-extrabold">
              {a.question_count} {a.question_count === 1 ? 'question' : 'questions'}
            </h1>
            <Button className="ml-auto" onClick={addQuestion}>
              <Plus className="h-4 w-4" /> Add question
            </Button>
          </div>
          <ErrorText error={patch.error || del.error || reorder.error || quick.error} />

          {a.questions.length === 0 && (
            <div className="rounded-2xl border border-line bg-card p-10 text-center">
              <div className="text-lg font-bold">Start building your {KIND_LABEL[a.kind].toLowerCase()}</div>
              <p className="mt-1 text-sm text-muted">Add your first question. You can reorder, time and mark each one.</p>
            </div>
          )}

          <ol className="space-y-3">
            {a.questions.map((q, i) => {
              const Icon = TYPE_ICON[q.type];
              return (
                <li
                  key={q.id}
                  draggable
                  onDragStart={() => setDragFrom(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => drop(i)}
                  className={cx('group rounded-2xl border border-line bg-card shadow-sm transition hover:border-brand-200', dragFrom === i && 'opacity-50')}
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                    <GripVertical className="h-4 w-4 cursor-grab text-muted" aria-hidden />
                    <span className="text-sm font-extrabold">Q{i + 1}.</span>
                    <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-muted">
                      <Icon className="h-3.5 w-3.5" aria-hidden /> {TYPE_LABEL[q.type]}
                    </span>
                    {q.rubric?.length ? <Pill>rubric</Pill> : null}
                    <div className="ml-auto flex flex-wrap items-center gap-1">
                      {timed && (
                        <TimerSelect
                          className="rounded-lg border border-line bg-card px-2 py-1 text-xs font-semibold"
                          aria-label={`Question ${i + 1} timer`}
                          value={q.time_limit_seconds ? String(q.time_limit_seconds) : ''}
                          onChange={(v) => quick.mutate({ q, patch: { time_limit_seconds: v ? Number(v) : null } })}
                        />
                      )}
                      {graded && (
                        <select
                          className="rounded-lg border border-line bg-card px-2 py-1 text-xs font-semibold"
                          aria-label={`Question ${i + 1} marks`}
                          value={String(Number(q.marks))}
                          onChange={(e) => quick.mutate({ q, patch: { marks: Number(e.target.value) } })}
                        >
                          {[...new Set([...MARK_PRESETS, Number(q.marks)])]
                            .sort((x, y) => x - y)
                            .map((m) => (
                              <option key={m} value={m}>
                                {m} {m === 1 ? 'mark' : 'marks'}
                              </option>
                            ))}
                        </select>
                      )}
                      <IconBtn label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn label={`Move question ${i + 1} down`} disabled={i === a.questions.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </IconBtn>
                      <Button variant="secondary" className="!px-2.5 !py-1" aria-label={`Edit question ${i + 1}`} onClick={() => setEditing({ id: q.id, index: i, data: toData(q) })}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <IconBtn label={`Duplicate question ${i + 1}`} onClick={() => dupQ.mutate(q)}>
                        <Copy className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn label={`Delete question ${i + 1}`} onClick={() => confirm('Delete this question?') && del.mutate(q.id)}>
                        <Trash2 className="h-4 w-4" />
                      </IconBtn>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    {q.stem_image_id && <AuthImage id={q.stem_image_id} className="max-h-32 rounded-lg" />}
                    <p className="whitespace-pre-wrap font-semibold">{q.stem}</p>
                    {q.options.length > 0 && (
                      <>
                        <div className="text-xs font-bold uppercase tracking-wide text-muted">Answer choices</div>
                        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                          {q.options.map((o, j) => (
                            <div key={j} className="flex items-center gap-2 text-sm">
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: TILE_COLORS[j % TILE_COLORS.length] }} aria-hidden />
                              <span className={o.correct ? 'font-semibold' : 'text-muted'}>{o.text || '(image)'}</span>
                              {o.correct && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="correct" />}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {q.type === 'true_false' && <p className="text-sm text-muted">Answer: {q.answer.value ? 'True' : 'False'}</p>}
                    {q.type === 'fill_blank' && <p className="text-sm text-muted">Answers: {((q.answer.blanks as string[][]) ?? []).map((b) => b.join(' / ')).join(' ; ')}</p>}
                    {a.kind === 'flashcards' && q.explanation && <p className="text-sm text-muted">Back: {q.explanation}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            onClick={addQuestion}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-card/50 py-5 font-bold text-brand-700 transition hover:border-brand-500 hover:bg-brand-50 dark:text-brand-200"
          >
            <Plus className="h-5 w-5" /> Add another question
          </button>
        </section>
      </div>

      <TypePicker
        types={TYPES_FOR[a.kind]}
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(t: QuestionType) => {
          setPicker(false);
          setEditing({ id: null, index: a.questions.length, data: blankQuestion(t, a.kind) });
        }}
      />

      {editing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface" role="dialog" aria-modal="true" aria-label={editing.id ? 'Edit question' : 'New question'}>
          <div className="border-b border-line bg-card px-3 py-2.5 sm:px-6">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
              <button onClick={() => setEditing(null)} className="rounded-lg p-1.5 hover:bg-brand-50" aria-label="Close editor">
                <X className="h-5 w-5" />
              </button>
              <span className="font-extrabold">Question {editing.index + 1}</span>
              <QuestionToolbar kind={a.kind} value={editing.data} onChange={(d) => setEditing({ ...editing, data: d })} />
              <div className="ml-auto flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button loading={save.isPending} onClick={() => save.mutate({ qid: editing.id, data: editing.data })}>
                  Save question
                </Button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 sm:p-6">
            <div className="mx-auto max-w-6xl">
              <QuestionEditor kind={a.kind} value={editing.data} onChange={(d) => setEditing({ ...editing, data: d })} />
              <div className="mt-4">
                <ErrorText error={save.error} />
              </div>
            </div>
          </div>
        </div>
      )}

      <AssignDrawer
        activity={a}
        open={assigning}
        onClose={() => setAssigning(false)}
        onDone={(asg: AssignmentInfo) => {
          setAssigning(false);
          refresh();
          nav(`/faculty/reports/${asg.id}`);
        }}
      />
      {preview && <PreviewModal activity={a} onClose={() => setPreview(false)} />}
      {forever && (
        <DeleteForever
          title={`Delete "${a.title}" for good`}
          endpoint={`/admin/data/activities/${a.id}/delete`}
          confirmWord={a.title}
          onClose={() => setForever(false)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['activities'] });
            nav('/faculty/library');
          }}
        >
          <p className="mt-1">
            This removes the activity, its {a.questions.length} questions, every assignment and room of it ({a.assignment_count}), and <b>all student attempts and marks</b> on them.
          </p>
        </DeleteForever>
      )}
      {classDlg && <ClassDialog activity={a} onClose={() => setClassDlg(false)} onDone={(d) => (setClassDlg(false), refresh(d))} />}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 hover:text-ink disabled:opacity-30">
      {children}
    </button>
  );
}

function ClassDialog({ activity, onClose, onDone }: { activity: Activity; onClose: () => void; onDone: (a: Activity) => void }) {
  const classes = useClassOptions();
  const [ids, setIds] = useState<number[]>(activity.section_ids);
  const saveIt = useMutation({ mutationFn: () => api<Activity>(`/activities/${activity.id}`, { method: 'PATCH', json: { section_ids: ids } }), onSuccess: onDone });
  return (
    <Modal open onClose={onClose} title="Classes for this activity">
      <div className="space-y-4">
        <ClassPicker data={classes.data} value={ids} onChange={setIds} />
        <ErrorText error={saveIt.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saveIt.isPending} onClick={() => saveIt.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Wayground-style bulk update: one timer and/or one mark value for every question. */
function BulkBar({ activity, onDone }: { activity: Activity; onDone: (a: Activity) => void }) {
  const [timer, setTimer] = useState('keep');
  const [marks, setMarks] = useState('keep');
  const graded = activity.kind === 'quiz' || activity.kind === 'assignment';
  const apply = useMutation({
    mutationFn: () =>
      api<Activity>(`/activities/${activity.id}/apply-all`, {
        method: 'POST',
        json: { clear_timer: timer === 'none', time_limit_seconds: timer !== 'keep' && timer !== 'none' ? Number(timer) : null, marks: marks !== 'keep' ? Number(marks) : null },
      }),
    onSuccess: (d) => {
      setTimer('keep');
      setMarks('keep');
      onDone(d);
    },
  });
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-card p-4 shadow-sm">
      <div className="text-sm font-extrabold">Timer / marks for all</div>
      <TimerSelect
        className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        aria-label="Timer for all questions"
        value={timer}
        onChange={setTimer}
        head={[
          ['keep', "Timer: keep each question's"],
          ['none', 'No timer'],
        ]}
      />
      {graded && (
        <Select value={marks} onChange={(e) => setMarks(e.target.value)} aria-label="Marks for all questions">
          <option value="keep">Marks: keep each question's</option>
          {MARK_PRESETS.filter((m) => m > 0).map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? 'mark' : 'marks'}
            </option>
          ))}
        </Select>
      )}
      <ErrorText error={apply.error} />
      <Button variant="secondary" className="w-full" disabled={timer === 'keep' && marks === 'keep'} loading={apply.isPending} onClick={() => apply.mutate()}>
        Update all questions
      </Button>
    </div>
  );
}
