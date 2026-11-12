import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { Department, Section, Subject } from '../../api/types';
import { ConfirmDelete } from '../../components/ConfirmDelete';
import { Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Select, Spinner, Table, Td } from '../../components/ui';

export function currentAcademicYear(d = new Date()): string {
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function DepartmentsCard() {
  const qc = useQueryClient();
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });
  const [form, setForm] = useState({ code: '', name: '' });
  const add = useMutation({
    mutationFn: () => api('/departments', { method: 'POST', json: form }),
    onSuccess: () => {
      setForm({ code: '', name: '' });
      void qc.invalidateQueries({ queryKey: ['departments'] });
    },
  });
  const [gone, setGone] = useState<Department | null>(null);
  return (
    <Card>
      <h2 className="mb-3 font-bold">Departments</h2>
      <form
        className="mb-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input className="sm:w-28" placeholder="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <Input placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Button type="submit" loading={add.isPending}>
          Add
        </Button>
      </form>
      <ErrorText error={add.error} />
      <div className="flex flex-wrap gap-2">
        {depts.data?.map((d) => (
          <span key={d.id} className="inline-flex items-center gap-1 rounded-xl border border-line py-0.5 pl-3 pr-1 text-sm">
            <b>{d.code}</b> <span className="text-muted">{d.name}</span>
            <button type="button" onClick={() => setGone(d)} aria-label={`Delete department ${d.code}`} title="Delete department" className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950">
              <Trash2 className="h-4 w-4" />
            </button>
          </span>
        ))}
        {depts.data?.length === 0 && <p className="text-sm text-muted">No departments yet. Imports create them automatically.</p>}
      </div>
      {gone && (
        <ConfirmDelete
          title="Delete department"
          what={`${gone.code} ${gone.name}`}
          impactUrl={`/departments/${gone.id}/delete-impact`}
          run={() => api(`/departments/${gone.id}`, { method: 'DELETE' })}
          onClose={() => setGone(null)}
          onDone={() => {
            setGone(null);
            void qc.invalidateQueries({ queryKey: ['departments'] });
            void qc.invalidateQueries({ queryKey: ['subjects'] });
          }}
        >
          <p className="mt-1">Only an empty department can be deleted: no sections and no people in it.</p>
        </ConfirmDelete>
      )}
    </Card>
  );
}

export function SectionsPage() {
  const qc = useQueryClient();
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });
  const [year, setYear] = useState(currentAcademicYear());
  const sections = useQuery({
    queryKey: ['sections', year],
    queryFn: () => api<Section[]>(`/sections?academic_year=${encodeURIComponent(year)}`),
  });
  const [form, setForm] = useState({ department_id: '', semester: '1', name: '' });
  const add = useMutation({
    mutationFn: () =>
      api('/sections', {
        method: 'POST',
        json: { department_id: Number(form.department_id), semester: Number(form.semester), name: form.name, academic_year: year },
      }),
    onSuccess: () => {
      setForm({ ...form, name: '' });
      void qc.invalidateQueries({ queryKey: ['sections'] });
    },
  });
  const [gone, setGone] = useState<Section | null>(null);

  return (
    <>
      <PageHeader title="Sections" subtitle="Departments, semesters and class sections" />
      <div className="grid gap-6">
        <DepartmentsCard />
        <Card>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-bold">Sections</h2>
            <Field label="Academic year">
              <Input className="w-32" value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
          </div>
          <form
            className="mb-4 grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Select required aria-label="Department" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
              <option value="">Department</option>
              {depts.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </Select>
            <Select aria-label="Semester" value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })}>
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Sem {i + 1}
                </option>
              ))}
            </Select>
            <Input aria-label="Section name" placeholder="Section (A)" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Button type="submit" loading={add.isPending}>
              Add section
            </Button>
          </form>
          <ErrorText error={add.error} />
          {sections.isLoading ? (
            <Spinner />
          ) : sections.data?.length ? (
            <Table head={['Dept', 'Section', 'Students', '']} cols={[undefined, undefined, 'hidden sm:table-cell', 'w-px']} compact>
              {sections.data.map((s) => (
                <tr key={s.id}>
                  <Td className="font-semibold">{s.department_code}</Td>
                  <Td>
                    Sem {s.semester} {s.name}
                    <div className="text-xs text-muted sm:hidden">{s.student_count} students</div>
                  </Td>
                  <Td className="hidden sm:table-cell">{s.student_count}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" title="Delete section" aria-label={`Delete section ${s.department_code} Sem ${s.semester} ${s.name}`} onClick={() => setGone(s)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title={`No sections for ${year}`}>Add one above or import students.</EmptyState>
          )}
        </Card>
      </div>
      {gone && (
        <ConfirmDelete
          title="Delete section"
          what={`${gone.department_code} Sem ${gone.semester} ${gone.name}`}
          impactUrl={`/sections/${gone.id}/delete-impact`}
          run={() => api(`/sections/${gone.id}`, { method: 'DELETE' })}
          onClose={() => setGone(null)}
          onDone={() => {
            setGone(null);
            void qc.invalidateQueries({ queryKey: ['sections'] });
            void qc.invalidateQueries({ queryKey: ['assignments'] });
          }}
        >
          <p className="mt-1">The students keep their accounts; they only leave this section.</p>
        </ConfirmDelete>
      )}
    </>
  );
}

export function SubjectsPage() {
  const qc = useQueryClient();
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api<Subject[]>('/subjects') });
  const [form, setForm] = useState({ code: '', name: '', department_id: '', semester: '' });
  const add = useMutation({
    mutationFn: () =>
      api('/subjects', {
        method: 'POST',
        json: {
          code: form.code,
          name: form.name,
          department_id: form.department_id ? Number(form.department_id) : null,
          semester: form.semester ? Number(form.semester) : null,
        },
      }),
    onSuccess: () => {
      setForm({ code: '', name: '', department_id: form.department_id, semester: form.semester });
      void qc.invalidateQueries({ queryKey: ['subjects'] });
    },
  });
  const deptCode = (id: number | null) => depts.data?.find((d) => d.id === id)?.code ?? '';
  const [gone, setGone] = useState<Subject | null>(null);

  return (
    <>
      <PageHeader title="Subjects" />
      <Card className="mb-6">
        <form
          className="grid gap-2 sm:grid-cols-[140px_1fr_120px_110px_auto]"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input aria-label="Subject code" placeholder="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input aria-label="Subject name" placeholder="Subject name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select aria-label="Department" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">Dept</option>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </Select>
          <Select aria-label="Semester" value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })}>
            <option value="">Sem</option>
            {Array.from({ length: 8 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </Select>
          <Button type="submit" loading={add.isPending}>
            Add
          </Button>
        </form>
        <div className="mt-2">
          <ErrorText error={add.error} />
        </div>
      </Card>
      {subjects.isLoading ? (
        <Spinner />
      ) : subjects.data?.length ? (
        <Table head={['Code', 'Name', 'Dept', 'Sem', '']} cols={[undefined, undefined, 'hidden sm:table-cell', 'hidden sm:table-cell', 'w-px']} compact>
          {subjects.data.map((s) => (
            <tr key={s.id}>
              <Td className="break-all font-mono font-semibold">{s.code}</Td>
              <Td>
                {s.name}
                {/* phones: department and semester under the name */}
                <div className="text-xs text-muted sm:hidden">
                  {[deptCode(s.department_id), s.semester ? `Sem ${s.semester}` : ''].filter(Boolean).join(' | ')}
                </div>
              </Td>
              <Td className="hidden sm:table-cell">{deptCode(s.department_id)}</Td>
              <Td className="hidden sm:table-cell">{s.semester ?? ''}</Td>
              <Td className="text-right">
                <Button variant="ghost" title="Delete subject" aria-label={`Delete subject ${s.code}`} onClick={() => setGone(s)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No subjects yet">Add one above or import a faculty mapping sheet.</EmptyState>
      )}
      {gone && (
        <ConfirmDelete
          title="Delete subject"
          what={`${gone.code} ${gone.name}`}
          impactUrl={`/subjects/${gone.id}/delete-impact`}
          run={() => api(`/subjects/${gone.id}`, { method: 'DELETE' })}
          onClose={() => setGone(null)}
          onDone={() => {
            setGone(null);
            void qc.invalidateQueries({ queryKey: ['subjects'] });
            void qc.invalidateQueries({ queryKey: ['assignments'] });
          }}
        >
          <p className="mt-1">Teachers mapped to a section through this subject lose that mapping. Activities keep their questions and results.</p>
        </ConfirmDelete>
      )}
    </>
  );
}
