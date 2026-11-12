import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, downloadFile } from '../../api/client';
import type { ImportFields, ImportJob } from '../../api/types';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Button, Card, ErrorText, PageHeader, Select, Spinner, Table, Td } from '../../components/ui';
import { KIND_LABEL, StatusBadge } from './ImportsPage';

const BUSY: ImportJob['status'][] = ['uploaded', 'parsing', 'committing'];

const FIELD_LABEL: Record<string, string> = {
  usn: 'USN',
  employee_id: 'Employee ID',
  full_name: 'Full name',
  email: 'Email',
  department: 'Department',
  semester: 'Semester',
  section: 'Section',
  subject_code: 'Subject code',
  subject_name: 'Subject name',
};

export default function ImportDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const job = useQuery({
    queryKey: ['import', id],
    queryFn: () => api<ImportJob>(`/imports/${id}`),
    refetchInterval: (q) => (q.state.data && BUSY.includes(q.state.data.status) ? 1000 : false),
  });
  const fields = useQuery({ queryKey: ['import-fields'], queryFn: () => api<ImportFields[]>('/imports/fields') });
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (job.data?.header_map) setMap(job.data.header_map);
  }, [job.data?.header_map]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['import', id] });
    void qc.invalidateQueries({ queryKey: ['imports'] });
  };
  const remap = useMutation({
    mutationFn: () => api(`/imports/${id}/mapping`, { method: 'PUT', json: { header_map: map } }),
    onSuccess: refresh,
  });
  const commit = useMutation({ mutationFn: () => api(`/imports/${id}/commit`, { method: 'POST' }), onSuccess: refresh });
  const [purging, setPurging] = useState(false);
  const download = useMutation({
    mutationFn: () => downloadFile(`/imports/${id}/credentials.pdf`, `openqz-credentials-${j?.kind}-${id?.slice(0, 8)}.pdf`),
  });

  const j = job.data;
  if (job.isLoading || !j) return job.error ? <ErrorText error={job.error} /> : <Spinner />;
  const spec = fields.data?.find((f) => f.kind === j.kind);
  const busy = BUSY.includes(j.status);
  const previewCols = j.preview_rows?.[0] ? Object.keys(j.preview_rows[0]).filter((k) => !['row', 'exists'].includes(k)) : [];

  return (
    <>
      <Link to="/admin/imports" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Imports
      </Link>
      <PageHeader
        title={j.original_filename}
        subtitle={`${KIND_LABEL[j.kind]}  |  ${j.academic_year}`}
        actions={<StatusBadge status={j.status} />}
      />

      {busy && (
        <Card className="mb-6 flex items-center gap-3">
          <Spinner small /> <span>{j.status === 'committing' ? 'Importing rows' : 'Reading the file'}...</span>
        </Card>
      )}

      {j.message && !busy && <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm">{j.message}</p>}

      {j.status === 'done' && (
        <Card className="mb-6">
          <h2 className="font-bold">Import complete</h2>
          <p className="mt-1 text-sm text-muted">
            {j.created_count} created, {j.updated_count} updated.
          </p>
          {j.has_credentials ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => download.mutate()} loading={download.isPending}>
                <Download className="h-4 w-4" /> Credential slips (PDF)
              </Button>
              <Button variant="secondary" onClick={() => setPurging(true)}>
                <Trash2 className="h-4 w-4" /> Delete PDF from server
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">No new accounts, or the credential sheet was already deleted.</p>
          )}
          <ErrorText error={download.error} />
        </Card>
      )}

      {(j.status === 'preview' || j.status === 'failed') && spec && j.source_headers && (
        <Card className="mb-6">
          <h2 className="mb-1 font-bold">Column mapping</h2>
          <p className="mb-4 text-sm text-muted">Check which column of your sheet fills each field.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...spec.required, ...spec.optional].map((f) => (
              <label key={f} className="block space-y-1 text-sm">
                <span className="font-medium">
                  {FIELD_LABEL[f] ?? f} {spec.required.includes(f) && <span className="text-red-600">*</span>}
                </span>
                <Select value={map[f] ?? ''} onChange={(e) => setMap({ ...map, [f]: e.target.value })}>
                  <option value="">Not in file</option>
                  {j.source_headers!.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => remap.mutate()} loading={remap.isPending}>
              Re-check with this mapping
            </Button>
            <Button onClick={() => commit.mutate()} loading={commit.isPending} disabled={j.valid_rows === 0}>
              Import {j.valid_rows} valid rows
            </Button>
          </div>
          <div className="mt-2">
            <ErrorText error={remap.error || commit.error} />
          </div>
        </Card>
      )}

      {!!j.error_rows?.length && (
        <>
          <h2 className="mb-3 font-bold text-red-700 dark:text-red-400">Rows with errors ({j.error_rows.length}). These will be skipped.</h2>
          <div className="mb-6">
            <Table head={['Row', 'Problems', 'Values']}>
              {j.error_rows.map((e) => (
                <tr key={e.row}>
                  <Td className="font-mono">{e.row}</Td>
                  <Td>
                    <ul className="list-inside list-disc text-red-700 dark:text-red-400">
                      {e.errors.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </Td>
                  <Td className="font-mono text-xs text-muted">
                    {Object.entries(e.values)
                      .filter(([k]) => k !== 'row')
                      .map(([k, v]) => `${k}=${String(v ?? '')}`)
                      .join('  ')}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}

      {!!j.preview_rows?.length && j.status === 'preview' && (
        <>
          <h2 className="mb-3 font-bold">Preview (first {j.preview_rows.length} valid rows)</h2>
          <Table head={['Row', ...previewCols.map((c) => FIELD_LABEL[c] ?? c), 'New?']}>
            {j.preview_rows.map((r) => (
              <tr key={String(r.row)}>
                <Td className="font-mono">{String(r.row)}</Td>
                {previewCols.map((c) => (
                  <Td key={c}>{String(r[c] ?? '')}</Td>
                ))}
                <Td>{r.exists ? 'update' : 'new'}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {purging && (
        <ConfirmDelete
          title="Delete credential PDF"
          what="the credential PDF"
          run={() => api(`/imports/${id}/credentials`, { method: 'DELETE' })}
          onClose={() => setPurging(false)}
          onDone={() => {
            setPurging(false);
            refresh();
          }}
        >
          <p className="mt-1">The slips with the temporary passwords are removed from the server. Do this after printing; they cannot be made again.</p>
        </ConfirmDelete>
      )}
    </>
  );
}
