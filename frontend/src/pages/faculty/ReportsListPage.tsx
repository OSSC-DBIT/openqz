import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { AssignmentInfo } from '../../api/types';
import { Badge, EmptyState, ErrorText, PageHeader, Spinner, Table, Td } from '../../components/ui';
import { KIND_LABEL } from '../../components/quiz';

export default function ReportsListPage() {
  const list = useQuery({ queryKey: ['my-assignments'], queryFn: () => api<AssignmentInfo[]>('/activity-assignments') });
  const now = Date.now();
  return (
    <>
      <PageHeader title="Reports" subtitle="Everything you have assigned" />
      <ErrorText error={list.error} />
      {list.isLoading ? (
        <Spinner />
      ) : list.data?.length ? (
        <Table head={['Activity', 'Assigned to', 'Deadline', 'Submitted', '']} cols={[undefined, 'hidden md:table-cell', 'hidden lg:table-cell', undefined, 'hidden sm:table-cell']} compact>
          {list.data.map((a) => {
            const open = !a.due_at || new Date(a.due_at).getTime() > now || a.allow_late;
            return (
              <tr key={a.id}>
                <Td>
                  <Link to={`/faculty/reports/${a.id}`} className="font-semibold text-brand-ink hover:underline">
                    {a.activity_title}
                  </Link>
                  <div className="text-xs text-muted">{KIND_LABEL[a.activity_kind]}</div>
                  {/* smaller screens: classes, deadline and state under the title */}
                  <div className="mt-1 text-xs text-muted md:hidden">{a.target_labels.join(', ') || 'Join code only'}</div>
                  <div className="text-xs text-muted lg:hidden">Deadline: {a.due_at ? new Date(a.due_at).toLocaleString() : 'none'}</div>
                  <div className="mt-1 sm:hidden">
                    <Badge tone={open ? 'green' : 'neutral'}>{open ? 'running' : 'ended'}</Badge>
                  </div>
                </Td>
                <Td className="hidden text-sm md:table-cell">{a.target_labels.join(', ')}</Td>
                <Td className="hidden text-sm text-muted lg:table-cell">{a.due_at ? new Date(a.due_at).toLocaleString() : 'none'}</Td>
                <Td className="whitespace-nowrap">
                  {a.submitted_count} / {a.student_count}
                </Td>
                <Td className="hidden sm:table-cell">
                  <Badge tone={open ? 'green' : 'neutral'}>{open ? 'running' : 'ended'}</Badge>
                </Td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <EmptyState title="Nothing assigned yet">Open an activity in your library and press Assign.</EmptyState>
      )}
    </>
  );
}
