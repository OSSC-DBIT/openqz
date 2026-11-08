import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { IntegrityEvent } from '../../api/types';
import { EmptyState, ErrorText, PageHeader, Spinner, Table, Td } from '../../components/ui';

export default function IntegrityPage() {
  const events = useQuery({
    queryKey: ['integrity'],
    queryFn: () => api<IntegrityEvent[]>('/integrity/events?limit=200'),
    refetchInterval: 15000,
  });
  return (
    <>
      <PageHeader title="Exam integrity log" subtitle="Tab switches, back navigation, reloads and other events reported during quizzes" />
      <ErrorText error={events.error} />
      {events.isLoading ? (
        <Spinner />
      ) : events.data?.length ? (
        <Table head={['When', 'Student', 'Event', 'Details']}>
          {events.data.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-muted">{new Date(e.client_at).toLocaleString()}</Td>
              <Td>
                <div className="font-semibold">{e.full_name}</div>
                <div className="font-mono text-xs text-muted">{e.username}</div>
              </Td>
              <Td className="font-mono">{e.kind}</Td>
              <Td className="font-mono text-xs text-muted">{e.meta ? JSON.stringify(e.meta) : ''}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No events yet">Events appear here once students start attempting quizzes.</EmptyState>
      )}
    </>
  );
}
