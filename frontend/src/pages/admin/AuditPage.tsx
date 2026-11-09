import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import type { AuditEntry, Page } from '../../api/types';
import { Button, EmptyState, ErrorText, Input, PageHeader, Select, Spinner, Table, Td } from '../../components/ui';

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const actions = useQuery({ queryKey: ['audit-actions'], queryFn: () => api<string[]>('/audit/actions') });
  const params = new URLSearchParams({ page: String(page), size: '50' });
  if (action) params.set('action', action);
  if (q.trim()) params.set('q', q.trim());
  const log = useQuery({ queryKey: ['audit', action, q, page], queryFn: () => api<Page<AuditEntry>>(`/audit?${params}`), placeholderData: (p) => p });
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / log.data.size)) : 1;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Sign-ins, lockouts, password resets, imports, assignments and marks releases" />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search person or target"
            aria-label="Search audit log"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          className="sm:!w-56"
          aria-label="Filter by action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All actions</option>
          {actions.data?.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </div>
      <ErrorText error={log.error} />
      {log.isLoading ? (
        <Spinner />
      ) : log.data?.items.length ? (
        <Table head={['When', 'Action', 'Who', 'Target', 'Details']} cols={['hidden sm:table-cell', undefined, 'hidden sm:table-cell', 'hidden xl:table-cell', 'hidden 2xl:table-cell']} compact>
          {log.data.items.map((e) => (
            <tr key={e.id}>
              <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{new Date(e.at).toLocaleString()}</Td>
              <Td>
                <div className="font-mono text-xs">{e.action}</div>
                {/* phones: who and when under the action */}
                <div className="mt-1 text-sm sm:hidden">{e.actor ?? <span className="text-muted">-</span>}</div>
                <div className="text-xs text-muted sm:hidden">{new Date(e.at).toLocaleString()}</div>
                {e.target && <div className="max-w-[16rem] truncate font-mono text-xs text-muted xl:hidden">{e.target}</div>}
              </Td>
              <Td className="hidden text-sm sm:table-cell">{e.actor ?? <span className="text-muted">-</span>}</Td>
              <Td className="hidden max-w-48 truncate font-mono text-xs xl:table-cell">{e.target}</Td>
              <Td className="hidden max-w-64 truncate font-mono text-xs text-muted 2xl:table-cell">{e.meta ? JSON.stringify(e.meta) : ''}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No entries" />
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}
