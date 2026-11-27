import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { ActivityKind } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { KIND_LABEL, fmtWhen } from '../../components/quiz';
import { Badge, EmptyState, ErrorText, Input, Loading, Modal, PageHeader, Table, Td } from '../../components/ui';

interface Person {
  student_id: string;
  usn: string;
  name: string;
  attempts: number;
  activities: number;
  submitted: number;
  in_progress: number;
  warnings: number;
  marks: string | null;
  max_marks: string | null;
  accuracy: number | null;
  last_seen: string | null;
}
interface PersonAttempt {
  attempt_id: string;
  assignment_id: string;
  title: string;
  kind: ActivityKind;
  is_room: boolean;
  status: 'in_progress' | 'submitted';
  submit_reason: string | null;
  started_at: string;
  submitted_at: string | null;
  marks: string | null;
  max_marks: string | null;
  pending_grading: boolean;
  warnings: number;
  late: boolean;
  can_unblock: boolean;
}

const REASON: Record<string, string> = { timer: 'time ran out', deadline: 'deadline passed', violations: 'too many warnings' };

/**
 * Participants tracker: everyone who attempted this teacher's or club's activities, across
 * all of them. Pick a person to see each attempt, its marks and warnings, and jump to the report.
 */
export default function ParticipantsPage() {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Person | null>(null);
  // search as you type, a moment after the last key
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const people = useQuery({ queryKey: ['participants', q], queryFn: () => api<Person[]>(`/participants${q ? `?q=${encodeURIComponent(q)}` : ''}`), refetchInterval: 30000 });
  const list = people.data ?? [];

  return (
    <>
      <PageHeader
        title="Participants"
        subtitle={user?.role === 'club' ? 'Everyone who played your rooms and games, with their attempts' : user?.role === 'admin' ? 'Everyone who attempted any activity, with their attempts' : 'Everyone who attempted your activities, with their attempts'}
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input className="pl-9" placeholder="Search by name or USN" aria-label="Search by name or USN" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <ErrorText error={people.error} />
      {people.isLoading ? (
        <Loading count={6} />
      ) : list.length === 0 ? (
        <EmptyState title={q ? 'Nobody matches that search' : 'No participants yet'}>{q ? 'Try a shorter name or the USN.' : 'People appear here as soon as they start one of your activities.'}</EmptyState>
      ) : (
        <Table head={['Participant', 'Attempts', user?.role === 'club' ? 'Points' : 'Marks obtained', 'Warnings', 'Last active', '']} cols={[undefined, 'hidden sm:table-cell', 'hidden md:table-cell', 'hidden sm:table-cell', 'hidden lg:table-cell', 'w-px']} compact>
          {list.map((p) => (
            <tr key={p.student_id} className="cursor-pointer transition-colors hover:bg-brand-50/60" onClick={() => setOpen(p)}>
              <Td>
                <button type="button" className="text-left" aria-label={`Attempts of ${p.name}`} onClick={() => setOpen(p)}>
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block font-mono text-xs text-muted">{p.usn}</span>
                </button>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted sm:hidden">
                  <span>
                    {p.submitted} of {p.attempts} done
                  </span>
                  {p.warnings > 0 && <span className="font-semibold text-red-700 dark:text-red-300">| {p.warnings} {p.warnings === 1 ? 'warning' : 'warnings'}</span>}
                </div>
              </Td>
              <Td className="hidden sm:table-cell">
                <span className="font-semibold">{p.submitted}</span> <span className="text-muted">of {p.attempts} done</span>
                {p.in_progress > 0 && (
                  <span className="ml-2">
                    <Badge tone="amber">{p.in_progress} in progress</Badge>
                  </span>
                )}
                <div className="text-xs text-muted">
                  {p.activities} {p.activities === 1 ? 'activity' : 'activities'}
                </div>
              </Td>
              <Td className="hidden md:table-cell">
                {p.marks === null ? (
                  <span className="text-muted">-</span>
                ) : (
                  <>
                    {Number(p.marks)} / {Number(p.max_marks)}
                    {p.accuracy !== null && <span className="ml-2 text-xs text-muted">{p.accuracy}%</span>}
                  </>
                )}
              </Td>
              <Td className="hidden sm:table-cell">{p.warnings > 0 ? <Badge tone="red">{p.warnings}</Badge> : <span className="text-muted">0</span>}</Td>
              <Td className="hidden whitespace-nowrap text-sm text-muted lg:table-cell">{fmtWhen(p.last_seen)}</Td>
              <Td>
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {open && <PersonDialog person={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function PersonDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const { user } = useAuth();
  const d = useQuery({ queryKey: ['participant', person.student_id], queryFn: () => api<{ attempts: PersonAttempt[] }>(`/participants/${person.student_id}`) });
  return (
    <Modal open onClose={onClose} title={`${person.name} (${person.usn})`}>
      <ErrorText error={d.error} />
      {d.isLoading ? (
        <Loading count={3} />
      ) : (
        <ul className="max-h-[65vh] space-y-2 overflow-y-auto">
          {(d.data?.attempts ?? []).map((a) => (
            <li key={a.attempt_id}>
              <Link to={`/faculty/reports/${a.assignment_id}`} className="block rounded-lg border border-edge p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/60">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-brand-ink">{KIND_LABEL[a.kind]}</span>
                  {a.is_room && <Badge tone="brand">room</Badge>}
                  <Badge tone={a.status === 'submitted' ? 'green' : 'amber'}>{a.status === 'submitted' ? 'submitted' : 'in progress'}</Badge>
                  {a.pending_grading && <Badge tone="amber">to mark</Badge>}
                  {a.late && <Badge tone="neutral">late</Badge>}
                </div>
                <div className="mt-1 font-semibold">{a.title}</div>
                <div className="mt-0.5 text-sm text-muted">
                  {a.max_marks !== null && (
                    <>
                      {user?.role === 'club' ? 'Points' : 'Marks obtained'} {a.marks === null ? '-' : Number(a.marks)} / {Number(a.max_marks)} |{' '}
                    </>
                  )}
                  {a.warnings} {a.warnings === 1 ? 'warning' : 'warnings'}
                  {a.submit_reason && REASON[a.submit_reason] ? ` | ended: ${REASON[a.submit_reason]}` : ''}
                </div>
                <div className="text-xs text-muted">
                  Started {fmtWhen(a.started_at)}
                  {a.submitted_at ? ` | submitted ${fmtWhen(a.submitted_at)}` : ''}
                  {a.can_unblock ? ' | can be unblocked from the report' : ''}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
