import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { Assignment, AssignmentInfo } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Card, EmptyState, ErrorText, PageHeader, Spinner } from '../../components/ui';
import { KIND_LABEL } from '../../components/quiz';

export default function FacultyHome() {
  const { user } = useAuth();
  const teaching = useQuery({ queryKey: ['me', 'teaching'], queryFn: () => api<Assignment[]>('/me/teaching') });
  const recent = useQuery({ queryKey: ['my-assignments'], queryFn: () => api<AssignmentInfo[]>('/activity-assignments') });
  return (
    <>
      <PageHeader
        title={`Hello, ${user?.full_name.split(' ')[0] ?? ''}`}
        subtitle="Your sections and recent activity"
        actions={
          <Link to="/faculty/library">
            <Button>
              <Plus className="h-4 w-4" /> Create or assign
            </Button>
          </Link>
        }
      />
      <ErrorText error={teaching.error || recent.error} />
      <h2 className="mb-3 font-bold">My sections</h2>
      {teaching.isLoading ? (
        <Spinner />
      ) : teaching.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teaching.data.map((a) => (
            <Card key={a.id}>
              <div className="font-mono text-xs font-semibold text-brand-600">{a.subject_code}</div>
              <div className="mt-1 font-bold">{a.subject_name}</div>
              <div className="mt-1 text-sm text-muted">{a.section_label}</div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No sections assigned yet">Ask the OpenQZ admin to map you to your sections and subjects.</EmptyState>
      )}

      <h2 className="mb-3 mt-8 font-bold">Recently assigned</h2>
      {recent.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {recent.data.slice(0, 6).map((a) => (
            <Link key={a.id} to={`/faculty/reports/${a.id}`}>
              <Card className="transition hover:border-brand-500">
                <div className="text-xs font-semibold text-brand-600">{KIND_LABEL[a.activity_kind]}</div>
                <div className="font-bold">{a.activity_title}</div>
                <div className="mt-1 text-sm text-muted">
                  {a.target_labels.join(', ')} | {a.submitted_count}/{a.student_count} submitted
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        !recent.isLoading && <p className="text-sm text-muted">Nothing assigned yet.</p>
      )}
    </>
  );
}
