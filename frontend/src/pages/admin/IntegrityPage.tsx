import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { IntegrityEvent } from '../../api/types';
import { EmptyState, ErrorText, Loading, PageHeader, Table, Td } from '../../components/ui';

const KIND: Record<string, string> = {
  visibility_hidden: 'Left the quiz (tab, app or screen lock)',
  focus_lost: 'Window lost focus',
  back_navigation: 'Pressed Back',
  page_reloaded: 'Reloaded or reopened the page',
  fullscreen_exit: 'Left full screen',
  second_device: 'Open in a second tab or device',
};

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
        <Loading />
      ) : events.data?.length ? (
        <Table head={['When', 'Student', 'Event', 'Details']} cols={['hidden sm:table-cell', undefined, undefined, 'hidden md:table-cell']} compact>
          {events.data.map((e) => (
            <tr key={e.id}>
              <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{new Date(e.client_at).toLocaleString()}</Td>
              <Td>
                <div className="font-semibold">{e.full_name}</div>
                <div className="font-mono text-xs text-muted">{e.username}</div>
                <div className="text-xs text-muted sm:hidden">{new Date(e.client_at).toLocaleString()}</div>
              </Td>
              <Td className="text-sm">{KIND[e.kind] ?? <span className="font-mono">{e.kind}</span>}</Td>
              <Td className="hidden font-mono text-xs text-muted md:table-cell">{e.meta ? JSON.stringify(e.meta) : ''}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No events yet">Events appear here once students start attempting quizzes.</EmptyState>
      )}
    </>
  );
}
