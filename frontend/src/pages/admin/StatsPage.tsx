import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { api, downloadFile } from '../../api/client';
import type { AdminStats, Department } from '../../api/types';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Select, Spinner, Table, Td } from '../../components/ui';

const pct = (v: number | null) => (v === null ? '-' : `${v}%`);

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="!p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-extrabold">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Card>
  );
}

/** A number with a thin bar under it (0 to 100). */
function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">-</span>;
  return (
    <div className="min-w-16">
      <div className="font-semibold">{value}%</div>
      <div className="mt-1 h-1.5 rounded-full bg-line" aria-hidden>
        <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

/** Admin: numbers for the whole college, per department and per teacher, with export. */
export default function StatsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dept, setDept] = useState('');
  const params = new URLSearchParams();
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  if (dept) params.set('department_id', dept);
  const qs = params.toString();

  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });
  const stats = useQuery({
    queryKey: ['admin-stats', from, to, dept],
    queryFn: () => api<AdminStats>(`/admin/stats${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const exportFile = useMutation({
    mutationFn: (kind: 'xlsx' | 'departments' | 'faculty') => {
      if (kind === 'xlsx') return downloadFile(`/admin/stats.xlsx${qs ? `?${qs}` : ''}`, 'openqz-stats.xlsx');
      const p = new URLSearchParams(params);
      p.set('sheet', kind);
      return downloadFile(`/admin/stats.csv?${p}`, `openqz-stats-${kind}.csv`);
    },
  });

  const s = stats.data;
  const t = s?.totals;
  const wrongRange = !!from && !!to && from > to;

  return (
    <>
      <PageHeader
        title="Statistics"
        subtitle="How OpenQZ is used across the college: by department and by teacher"
        actions={
          <>
            <Button variant="secondary" loading={exportFile.isPending && exportFile.variables === 'xlsx'} onClick={() => exportFile.mutate('xlsx')}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
            </Button>
            <Button variant="secondary" loading={exportFile.isPending && exportFile.variables === 'departments'} onClick={() => exportFile.mutate('departments')}>
              <Download className="h-4 w-4" aria-hidden /> Departments CSV
            </Button>
            <Button variant="secondary" loading={exportFile.isPending && exportFile.variables === 'faculty'} onClick={() => exportFile.mutate('faculty')}>
              <Download className="h-4 w-4" aria-hidden /> Faculty CSV
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Field label="Assigned from">
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Assigned to">
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Department">
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {wrongRange && <ErrorText error={new Error('The "from" day is after the "to" day.')} />}
      <ErrorText error={stats.error || exportFile.error} />

      {!s || !t ? (
        stats.isLoading && <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Students" value={t.students} />
            <Tile label="Faculty" value={t.faculty} hint={t.clubs ? `and ${t.clubs} club organisers` : undefined} />
            <Tile label="Activities made" value={t.activities} />
            <Tile label="Class assignments" value={t.assignments} hint={`${t.rooms} rooms, ${t.live_games} live games`} />
            <Tile label="Students assigned" value={t.assigned} hint="one per student per activity" />
            <Tile label="Submitted" value={t.submitted} hint={`completion ${pct(t.completion)}`} />
            <Tile label="Average marks" value={pct(t.avg_percent)} hint="of the maximum marks" />
            <Tile label="Waiting for grading" value={t.pending_grading} />
          </div>

          <h2 className="mb-2 mt-8 text-lg font-bold">By department</h2>
          <p className="mb-3 text-sm text-muted">Class assignments given to the department's sections. Rooms and live games are counted under the teacher who hosted them.</p>
          {s.departments.length === 0 ? (
            <EmptyState title="No departments yet" />
          ) : (
            <Table
              compact
              head={['Department', 'Students', 'Faculty', 'Sections', 'Activities', 'Assignments', 'Assigned', 'Submitted', 'Completion', 'Average marks']}
              cols={[undefined, 'hidden sm:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', undefined, 'hidden sm:table-cell']}
            >
              {s.departments.map((d) => (
                <tr key={d.department_id}>
                  <Td>
                    <div className="font-semibold">{d.code}</div>
                    <div className="text-xs text-muted">{d.name}</div>
                    <div className="mt-1 text-xs text-muted xl:hidden">
                      {d.students} students | {d.assignments} assignments | {d.submitted} of {d.assigned} submitted
                      <span className="sm:hidden"> | average {pct(d.avg_percent)}</span>
                    </div>
                  </Td>
                  <Td className="hidden sm:table-cell">{d.students}</Td>
                  <Td className="hidden xl:table-cell">{d.faculty}</Td>
                  <Td className="hidden xl:table-cell">{d.sections}</Td>
                  <Td className="hidden xl:table-cell">{d.activities}</Td>
                  <Td className="hidden xl:table-cell">{d.assignments}</Td>
                  <Td className="hidden xl:table-cell">{d.assigned}</Td>
                  <Td className="hidden xl:table-cell">{d.submitted}</Td>
                  <Td>
                    <Meter value={d.completion} />
                  </Td>
                  <Td className="hidden sm:table-cell">{pct(d.avg_percent)}</Td>
                </tr>
              ))}
            </Table>
          )}

          <h2 className="mb-2 mt-8 text-lg font-bold">By teacher and organiser</h2>
          <p className="mb-3 text-sm text-muted">Everything each person made and shared: class assignments, rooms and live games.</p>
          {s.faculty.length === 0 ? (
            <EmptyState title="No faculty or club organisers here yet" />
          ) : (
            <Table
              compact
              head={['Name', 'Departments', 'Classes', 'Activities', 'Assignments', 'Rooms', 'Live', 'Submitted', 'Completion', 'Average marks', 'To grade']}
              cols={[undefined, 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', 'hidden xl:table-cell', undefined, 'hidden sm:table-cell', 'hidden xl:table-cell']}
            >
              {s.faculty.map((f) => (
                <tr key={f.user_id}>
                  <Td>
                    <div className="font-semibold">
                      {f.name} {f.role !== 'faculty' && <Badge tone="neutral">{f.role === 'club' ? 'club' : f.role}</Badge>}
                    </div>
                    <div className="break-all text-xs text-muted">{f.email ?? f.username}</div>
                    <div className="mt-1 text-xs text-muted xl:hidden">
                      <span>{f.departments.join(', ') || 'no department'} | </span>
                      {f.activities} activities | {f.assignments + f.rooms + f.live_games} shared | {f.submitted} of {f.assigned} submitted
                      <span className="sm:hidden"> | average {pct(f.avg_percent)}</span>
                      {f.pending_grading > 0 && ` | ${f.pending_grading} to grade`}
                    </div>
                  </Td>
                  <Td className="hidden xl:table-cell">{f.departments.join(', ') || '-'}</Td>
                  <Td className="hidden xl:table-cell">{f.classes}</Td>
                  <Td className="hidden xl:table-cell">{f.activities}</Td>
                  <Td className="hidden xl:table-cell">{f.assignments}</Td>
                  <Td className="hidden xl:table-cell">{f.rooms}</Td>
                  <Td className="hidden xl:table-cell">{f.live_games}</Td>
                  <Td className="hidden xl:table-cell">
                    {f.submitted} / {f.assigned}
                  </Td>
                  <Td>
                    <Meter value={f.completion} />
                  </Td>
                  <Td className="hidden sm:table-cell">{pct(f.avg_percent)}</Td>
                  <Td className="hidden xl:table-cell">{f.pending_grading || '-'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </>
  );
}
