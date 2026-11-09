import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import type { ImportJob, ImportKind } from '../../api/types';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Select, Spinner, Table, Td } from '../../components/ui';
import { currentAcademicYear } from './OrgPage';

export const KIND_LABEL: Record<ImportKind, string> = {
  students: 'Students',
  faculty: 'Faculty',
  mapping: 'Faculty-section-subject mapping',
};

export function StatusBadge({ status }: { status: ImportJob['status'] }) {
  const tone = status === 'done' ? 'green' : status === 'failed' ? 'red' : status === 'preview' ? 'brand' : 'amber';
  return <Badge tone={tone}>{status}</Badge>;
}

const TEMPLATES: { kind: ImportKind; file: string; columns: string }[] = [
  { kind: 'students', file: '/templates/students_template.csv', columns: 'USN, Full Name, Email, Department, Semester, Section' },
  { kind: 'faculty', file: '/templates/faculty_template.csv', columns: 'Employee ID, Full Name, Email, Department' },
  { kind: 'mapping', file: '/templates/mapping_template.csv', columns: 'Employee ID, Department, Semester, Section, Subject Code, Subject Name (optional)' },
];

export default function ImportsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const jobs = useQuery({ queryKey: ['imports'], queryFn: () => api<ImportJob[]>('/imports') });
  const [kind, setKind] = useState<ImportKind>('students');
  const [year, setYear] = useState(currentAcademicYear());
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('academic_year', year);
      fd.append('file', file!);
      return api<ImportJob>('/imports', { method: 'POST', body: fd });
    },
    onSuccess: (job) => {
      void qc.invalidateQueries({ queryKey: ['imports'] });
      nav(`/admin/imports/${job.id}`);
    },
  });

  return (
    <>
      <PageHeader title="Imports" subtitle="Bring in students, faculty and teaching assignments from the office sheet" />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (file) upload.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What are you importing?">
                <Select value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
                  {(Object.keys(KIND_LABEL) as ImportKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Academic year">
                <Input value={year} onChange={(e) => setYear(e.target.value)} pattern="\d{4}-\d{2}" required />
              </Field>
            </div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-10 text-center hover:border-brand-500">
              <FileSpreadsheet className="h-8 w-8 text-brand-ink" />
              <span className="font-semibold">{file ? file.name : 'Choose a .csv or .xlsx file'}</span>
              <span className="text-xs text-muted">Max 10 MB. First row must be the header.</span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <ErrorText error={upload.error} />
            <Button type="submit" disabled={!file} loading={upload.isPending}>
              <Upload className="h-4 w-4" /> Upload and preview
            </Button>
          </form>
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">Templates</h2>
          <p className="mb-3 text-sm text-muted">Everyone needs an email: it is how they sign in (password or Google). Column names are matched loosely, e.g. "Roll No" works for USN. Import in this order: faculty, students, mapping.</p>
          <ul className="space-y-3">
            {TEMPLATES.map((t) => (
              <li key={t.kind} className="text-sm">
                <a href={t.file} download className="inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline">
                  <Download className="h-4 w-4" /> {KIND_LABEL[t.kind]}
                </a>
                <p className="text-xs text-muted">{t.columns}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 font-bold">Recent imports</h2>
      {jobs.isLoading ? (
        <Spinner />
      ) : jobs.data?.length ? (
        <Table head={['File', 'Type', 'Year', 'Status', 'Rows', 'When']} cols={[undefined, 'hidden md:table-cell', 'hidden md:table-cell', undefined, 'hidden lg:table-cell', 'hidden lg:table-cell']} compact>
          {jobs.data.map((j) => (
            <tr key={j.id}>
              <Td>
                <Link to={`/admin/imports/${j.id}`} className="font-semibold text-brand-ink hover:underline">
                  {j.original_filename}
                </Link>
                {/* smaller screens: type, year and row counts under the file name */}
                <div className="mt-1 text-xs text-muted lg:hidden">
                  <span className="md:hidden">
                    {KIND_LABEL[j.kind]} | {j.academic_year} |{' '}
                  </span>
                  {j.status === 'done' ? `${j.created_count} new, ${j.updated_count} updated` : `${j.valid_rows}/${j.total_rows} valid`}
                </div>
              </Td>
              <Td className="hidden md:table-cell">{KIND_LABEL[j.kind]}</Td>
              <Td className="hidden md:table-cell">{j.academic_year}</Td>
              <Td>
                <StatusBadge status={j.status} />
              </Td>
              <Td className="hidden text-muted lg:table-cell">
                {j.status === 'done' ? `${j.created_count} new, ${j.updated_count} updated` : `${j.valid_rows}/${j.total_rows} valid`}
              </Td>
              <Td className="hidden text-muted lg:table-cell">{new Date(j.created_at).toLocaleString()}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No imports yet" />
      )}
    </>
  );
}
