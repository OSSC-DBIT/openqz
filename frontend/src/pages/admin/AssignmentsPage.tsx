import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { Assignment, Page, Section, Subject, User } from '../../api/types';
import { Button, Card, EmptyState, ErrorText, PageHeader, Select, Spinner, Table, Td } from '../../components/ui';

export default function AssignmentsPage() {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ['assignments'], queryFn: () => api<Assignment[]>('/assignments') });
  const faculty = useQuery({ queryKey: ['users', 'faculty-all'], queryFn: () => api<Page<User>>('/users?role=faculty&size=200') });
  const sections = useQuery({ queryKey: ['sections', 'all'], queryFn: () => api<Section[]>('/sections') });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api<Subject[]>('/subjects') });
  const [form, setForm] = useState({ faculty_id: '', section_id: '', subject_id: '' });

  const add = useMutation({
    mutationFn: () =>
      api('/assignments', {
        method: 'POST',
        json: { faculty_id: form.faculty_id, section_id: Number(form.section_id), subject_id: Number(form.subject_id) },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['assignments'] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['assignments'] }),
  });

  return (
    <>
      <PageHeader title="Faculty mapping" subtitle="Who teaches which subject to which section" />
      <Card className="mb-6">
        <form
          className="grid gap-2 lg:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Select required aria-label="Faculty" value={form.faculty_id} onChange={(e) => setForm({ ...form, faculty_id: e.target.value })}>
            <option value="">Faculty</option>
            {faculty.data?.items.map((f) => (
              <option key={f.id} value={f.id}>
                {f.full_name} ({f.username})
              </option>
            ))}
          </Select>
          <Select required aria-label="Section" value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value })}>
            <option value="">Section</option>
            {sections.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.department_code} Sem {s.semester} {s.name} ({s.academic_year})
              </option>
            ))}
          </Select>
          <Select required aria-label="Subject" value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
            <option value="">Subject</option>
            {subjects.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {s.name}
              </option>
            ))}
          </Select>
          <Button type="submit" loading={add.isPending}>
            Assign
          </Button>
        </form>
        <div className="mt-2">
          <ErrorText error={add.error || del.error} />
        </div>
      </Card>

      {rows.isLoading ? (
        <Spinner />
      ) : rows.data?.length ? (
        <Table head={['Faculty', 'Section', 'Subject', '']} cols={[undefined, 'hidden sm:table-cell', 'hidden md:table-cell', 'w-px']} compact>
          {rows.data.map((r) => (
            <tr key={r.id}>
              <Td>
                <div className="font-semibold">{r.faculty_name}</div>
                <div className="font-mono text-xs text-muted">{r.faculty_username}</div>
                {/* phones: section and subject under the name */}
                <div className="mt-1 text-sm sm:hidden">{r.section_label}</div>
                <div className="text-sm md:hidden">
                  <span className="font-mono font-semibold">{r.subject_code}</span> {r.subject_name}
                </div>
              </Td>
              <Td className="hidden sm:table-cell">{r.section_label}</Td>
              <Td className="hidden md:table-cell">
                <span className="font-mono font-semibold">{r.subject_code}</span> {r.subject_name}
              </Td>
              <Td className="text-right">
                <Button variant="ghost" title="Remove" aria-label={`Remove ${r.faculty_name}: ${r.section_label}, ${r.subject_code}`} onClick={() => del.mutate(r.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No faculty mapped yet">Assign above or import a mapping sheet.</EmptyState>
      )}
    </>
  );
}
