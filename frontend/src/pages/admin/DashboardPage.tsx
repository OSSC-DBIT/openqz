import { useQuery } from '@tanstack/react-query';
import { BookOpen, GraduationCap, Layers, Upload, Users } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { Assignment, Page, Section, User } from '../../api/types';
import { Card, PageHeader } from '../../components/ui';
import { currentAcademicYear } from './OrgPage';

function Tile({ label, value, icon: Icon, to }: { label: string; value: number | string; icon: typeof Users; to: string }) {
  return (
    <Link to={to}>
      <Card className="transition hover:border-brand-500">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted">{label}</span>
          <Icon className="h-5 w-5 text-brand-ink" aria-hidden />
        </div>
        <div className="mt-2 text-3xl font-extrabold">{value}</div>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const year = currentAcademicYear();
  const count = (role: string) => ({
    queryKey: ['count', role],
    queryFn: () => api<Page<User>>(`/users?role=${role}&size=1`).then((p) => p.total),
  });
  const students = useQuery(count('student'));
  const faculty = useQuery(count('faculty'));
  const sections = useQuery({ queryKey: ['sections', year], queryFn: () => api<Section[]>(`/sections?academic_year=${year}`) });
  const assignments = useQuery({ queryKey: ['assignments'], queryFn: () => api<Assignment[]>('/assignments') });
  const dash = (v: number | undefined) => (v === undefined ? '...' : v);

  return (
    <>
      <PageHeader title="Admin dashboard" subtitle={`Academic year ${year}`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Students" value={dash(students.data)} icon={GraduationCap} to="/admin/users" />
        <Tile label="Faculty" value={dash(faculty.data)} icon={Users} to="/admin/users" />
        <Tile label="Sections" value={dash(sections.data?.length)} icon={Layers} to="/admin/sections" />
        <Tile label="Teaching assignments" value={dash(assignments.data?.length)} icon={BookOpen} to="/admin/assignments" />
      </div>
      <Card className="mt-6">
        <h2 className="font-bold">Getting started</h2>
        <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm text-muted">
          <li>
            Import <b>faculty</b>, then <b>students</b>, then the <b>faculty-section-subject mapping</b> from{' '}
            <Link to="/admin/imports" className="font-semibold text-brand-ink">
              <Upload className="mb-0.5 inline h-3.5 w-3.5" /> Imports
            </Link>
            .
          </li>
          <li>Download the credential slips PDF after each import and hand them to class teachers.</li>
          <li>Delete the PDF from the server once printed.</li>
          <li>Everyone changes their temporary password at first login.</li>
        </ol>
      </Card>
    </>
  );
}
