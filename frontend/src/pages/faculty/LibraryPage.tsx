import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Pencil, Plus, Search, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import type { Activity, ActivityKind, ActivitySummary, MyClasses } from '../../api/types';
import { ClassPicker, KindCover, Pill } from '../../components/pieces';
import { Badge, Button, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Select, Spinner, cx } from '../../components/ui';
import { KIND_LABEL, fmtSeconds } from '../../components/quiz';

const KIND_HELP: Record<ActivityKind, string> = {
  quiz: 'Auto-marked questions with timers',
  assignment: 'Longer work you mark yourself',
  poll: 'Opinions, no right answer',
  flashcards: 'Self-study cards',
};

export function useClassOptions(enabled = true) {
  const q = useQuery({ queryKey: ['me', 'classes'], queryFn: () => api<MyClasses>('/me/classes'), enabled });
  const semesters = useMemo(() => [...new Set((q.data?.classes ?? []).map((c) => c.semester))].sort((a, b) => a - b), [q.data]);
  return { ...q, semesters };
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const classes = useClassOptions(open);
  const [kind, setKind] = useState<ActivityKind | null>(null);
  const [title, setTitle] = useState('');
  const [sectionIds, setSectionIds] = useState<number[]>([]);
  const create = useMutation({
    mutationFn: () => api<Activity>('/activities', { method: 'POST', json: { title: title.trim() || 'Untitled', kind, section_ids: sectionIds } }),
    onSuccess: (a) => nav(`/faculty/activities/${a.id}`),
  });
  const close = () => {
    setKind(null);
    onClose();
  };
  const needsClass = classes.data?.can_use_sections && (classes.data?.classes.length ?? 0) > 0;

  return (
    <Modal open={open} onClose={close} title={kind ? `New ${KIND_LABEL[kind].toLowerCase()}` : 'What do you want to create?'}>
      {!kind ? (
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className="overflow-hidden rounded-2xl border border-line text-left transition hover:border-brand-500 hover:shadow-md">
              <KindCover kind={k} className="h-20" />
              <div className="p-3">
                <div className="font-bold">{KIND_LABEL[k]}</div>
                <div className="text-xs text-muted">{KIND_HELP[k]}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button type="button" onClick={() => setKind(null)} className="flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Change type
          </button>
          <Field label="Title">
            <Input placeholder="e.g. Unit 2: Linked lists" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          {classes.data?.can_use_sections && <p className="text-sm font-semibold">Classes: pick the branch, then any semesters and sections</p>}
          <ClassPicker data={classes.data} value={sectionIds} onChange={setSectionIds} />
          <ErrorText error={create.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={create.isPending} disabled={needsClass && sectionIds.length === 0} onClick={() => create.mutate()}>
              Create
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

type Shelf = 'all' | 'published' | 'draft' | 'used' | 'archived';
const SHELVES: { key: Shelf; label: string; test: (a: ActivitySummary) => boolean }[] = [
  { key: 'all', label: 'All activities', test: (a) => a.status !== 'archived' },
  { key: 'published', label: 'Published', test: (a) => a.status === 'published' },
  { key: 'draft', label: 'Drafts', test: (a) => a.status === 'draft' },
  { key: 'used', label: 'Previously used', test: (a) => a.assignment_count > 0 },
  { key: 'archived', label: 'Archived', test: (a) => a.status === 'archived' },
];

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(iso).toLocaleDateString();
}

export default function LibraryPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const classes = useClassOptions();
  const [params, setParams] = useSearchParams();
  const [semester, setSemester] = useState<number | ''>('');
  const [sectionId, setSectionId] = useState<number | ''>('');
  const [branch, setBranch] = useState<number | ''>('');
  const [kind, setKind] = useState<ActivityKind | ''>('');
  const [sort, setSort] = useState<'new' | 'old' | 'az'>('new');
  const [shelf, setShelf] = useState<Shelf>('all');
  const [q, setQ] = useState('');
  const qs = new URLSearchParams();
  if (semester) qs.set('semester', String(semester));
  if (sectionId) qs.set('section_id', String(sectionId));
  if (branch) qs.set('department_id', String(branch));
  const live = useQuery({ queryKey: ['activities', semester, sectionId, branch], queryFn: () => api<ActivitySummary[]>(`/activities?${qs}`) });
  // archived activities are left out of the normal list; fetch them for the Archived shelf
  const archivedQs = new URLSearchParams(qs);
  archivedQs.set('status_', 'archived');
  const archived = useQuery({ queryKey: ['activities', 'archived', semester, sectionId, branch], queryFn: () => api<ActivitySummary[]>(`/activities?${archivedQs}`) });
  const list = { data: live.data && [...live.data, ...(archived.data ?? [])], error: live.error || archived.error, isLoading: live.isLoading };
  const duplicate = useMutation({
    mutationFn: (id: string) => api<Activity>(`/activities/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['activities'] }),
  });
  const open = params.get('create') === '1';
  const all = list.data ?? [];
  const term = q.trim().toLowerCase();
  const shelfTest = SHELVES.find((s) => s.key === shelf)!.test;
  const shown = all
    .filter(shelfTest)
    .filter((a) => !kind || a.kind === kind)
    .filter((a) => !term || a.title.toLowerCase().includes(term))
    .sort((a, b) => (sort === 'az' ? a.title.localeCompare(b.title) : sort === 'old' ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)));
  const filtered = !!(term || kind || semester || branch);

  return (
    <>
      <PageHeader
        title="My library"
        subtitle="Everything you have created"
        actions={
          <Button onClick={() => setParams({ create: '1' })}>
            <Plus className="h-4 w-4" /> Create
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* shelves */}
        <nav aria-label="Library sections" className="flex gap-1 overflow-x-auto lg:flex-col">
          {SHELVES.map((s) => {
            const n = all.filter(s.test).length;
            const on = shelf === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => setShelf(s.key)}
                className={cx(
                  'flex shrink-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition',
                  on ? 'bg-brand-100 text-brand-700 dark:text-brand-200' : 'text-muted hover:bg-card hover:text-ink',
                )}
              >
                {s.label}
                <span className={cx('rounded-full px-2 text-xs', on ? 'bg-card' : 'bg-line/60')}>{n}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {/* toolbar */}
          <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-line bg-card p-2 shadow-sm md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input className="!border-transparent pl-9" placeholder="Search your library" aria-label="Search your library" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select className="!w-auto" aria-label="Activity type" value={kind} onChange={(e) => setKind(e.target.value as ActivityKind | '')}>
                <option value="">All types</option>
                {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
              {classes.data?.can_use_sections && (
                <>
                  {(classes.data.branches?.length ?? 0) > 1 && (
                    <Select
                      className="!w-auto"
                      aria-label="Filter by branch"
                      value={branch}
                      onChange={(e) => {
                        setBranch(e.target.value ? Number(e.target.value) : '');
                        setSectionId('');
                      }}
                    >
                      <option value="">All branches</option>
                      {classes.data.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Select
                    className="!w-auto"
                    aria-label="Filter by semester"
                    value={semester}
                    onChange={(e) => {
                      setSemester(e.target.value ? Number(e.target.value) : '');
                      setSectionId('');
                    }}
                  >
                    <option value="">All semesters</option>
                    {classes.semesters.map((s) => (
                      <option key={s} value={s}>
                        Sem {s}
                      </option>
                    ))}
                  </Select>
                  <Select className="!w-auto" aria-label="Filter by section" value={sectionId} disabled={!semester} onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">All sections</option>
                    {(classes.data?.classes ?? [])
                      .filter((c) => c.semester === semester && (!branch || c.department_id === branch))
                      .map((c) => (
                        <option key={c.section_id} value={c.section_id}>
                          {c.label}
                        </option>
                      ))}
                  </Select>
                </>
              )}
              <Select className="!w-auto" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'old' | 'az')}>
                <option value="new">Newest first</option>
                <option value="old">Oldest first</option>
                <option value="az">Name A to Z</option>
              </Select>
            </div>
          </div>

          <ErrorText error={list.error || duplicate.error} />
          {list.isLoading ? (
            <Spinner />
          ) : shown.length ? (
            <ul className="space-y-2.5" aria-label="Activities">
              {shown.map((a) => {
                const graded = a.kind === 'quiz' || a.kind === 'assignment';
                return (
                  <li key={a.id} className="group flex flex-col gap-3 rounded-2xl border border-line bg-card p-3 shadow-sm transition hover:border-brand-200 hover:shadow-md sm:flex-row sm:items-center">
                    <Link to={`/faculty/activities/${a.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                      <KindCover kind={a.kind} className="h-16 w-24 shrink-0 rounded-xl" />
                      <div className="min-w-0">
                        <div className="mb-0.5 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-200">{KIND_LABEL[a.kind]}</span>
                          {a.status !== 'published' && <Badge tone={a.status === 'draft' ? 'amber' : 'neutral'}>{a.status === 'draft' ? 'Draft' : 'Archived'}</Badge>}
                        </div>
                        <h3 className="truncate font-bold group-hover:text-brand-700 dark:group-hover:text-brand-200">{a.title}</h3>
                        <p className="truncate text-xs text-muted">
                          {a.question_count} questions{graded ? ` | ${Number(a.total_marks)} marks` : ''}
                          {a.time_limit_seconds ? ` | ${fmtSeconds(a.time_limit_seconds)}` : ''} | updated {ago(a.updated_at)}
                          {a.assignment_count ? ` | used ${a.assignment_count}x` : ''}
                        </p>
                        {a.class_labels.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {a.class_labels.slice(0, 3).map((l) => (
                              <Pill key={l}>{l}</Pill>
                            ))}
                            {a.class_labels.length > 3 && <Pill>+{a.class_labels.length - 3}</Pill>}
                          </div>
                        )}
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2 sm:pl-2">
                      <Button variant="ghost" className="!px-2.5" aria-label={`Duplicate ${a.title}`} title="Duplicate" loading={duplicate.isPending && duplicate.variables === a.id} onClick={() => duplicate.mutate(a.id)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="secondary" onClick={() => nav(`/faculty/activities/${a.id}`)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <Button disabled={!a.question_count} onClick={() => nav(`/faculty/activities/${a.id}?assign=1`)} aria-label={`Assign or host ${a.title}`}>
                        <Send className="h-4 w-4" /> Assign
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title={filtered || shelf !== 'all' ? 'Nothing here yet' : 'Your library is empty'}>
              {filtered || shelf !== 'all' ? (
                'Try another section or clear the filters.'
              ) : (
                <Button className="mt-3" onClick={() => setParams({ create: '1' })}>
                  <Plus className="h-4 w-4" /> Create your first activity
                </Button>
              )}
            </EmptyState>
          )}
        </div>
      </div>
      <CreateDialog open={open} onClose={() => setParams({})} />
    </>
  );
}
