import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, Mail, Plus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { Department, Page, Role, User } from '../../api/types';
import {
  Badge,
  Button,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
} from '../../components/ui';

function TempPassword({ username, email, password, onClose }: { username: string; email: string | null; password: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Temporary password">
      <p className="text-sm text-muted">Give this to the user. It is shown only once. They must change it at first login.</p>
      <div className="mt-4 rounded-xl bg-brand-50 p-4 font-mono text-sm">
        <div>Email: <b>{email ?? '(none: add one so they can sign in)'}</b></div>
        <div>USN / ID: <b>{username}</b></div>
        <div>Password: <b>{password}</b></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(`${email ?? username} / ${password}`)}>
          Copy
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function CreateUser({ open, onClose, depts }: { open: boolean; onClose: () => void; depts: Department[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', full_name: '', email: '', role: 'student' as Role, department_id: '' });
  const [created, setCreated] = useState<{ username: string; email: string | null; password: string } | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api<{ user: User; temporary_password: string }>('/users', {
        method: 'POST',
        json: {
          username: form.username.trim().toUpperCase(),
          full_name: form.full_name.trim(),
          email: form.email.trim().toLowerCase(),
          role: form.role,
          department_id: form.department_id ? Number(form.department_id) : null,
        },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setCreated({ username: r.user.username, email: r.user.email, password: r.temporary_password });
      setForm({ username: '', full_name: '', email: '', role: 'student', department_id: '' });
    },
  });

  if (created) {
    return (
      <TempPassword
        {...created}
        onClose={() => {
          setCreated(null);
          onClose();
        }}
      />
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add user">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username (USN / employee ID)">
            <Input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="club">Club organiser</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
        <Field label="Full name">
          <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email (used to sign in)">
            <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Department">
            <Select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
              <option value="">None</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={m.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditEmail({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState(user.email ?? '');
  const save = useMutation({
    mutationFn: () => api(`/users/${user.id}`, { method: 'PATCH', json: { email: email.trim().toLowerCase() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Email for ${user.full_name}`}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Email (used to sign in)" hint={user.google_linked ? 'Changing it unlinks their Google account.' : undefined}>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role | ''>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [temp, setTemp] = useState<{ username: string; email: string | null; password: string } | null>(null);
  const [editing, setEditing] = useState<User | null>(null);

  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });
  const params = new URLSearchParams({ page: String(page), size: '50' });
  if (role) params.set('role', role);
  if (q.trim()) params.set('q', q.trim());
  const users = useQuery({
    queryKey: ['users', role, q, page],
    queryFn: () => api<Page<User>>(`/users?${params}`),
    placeholderData: (prev) => prev,
  });

  const reset = useMutation({
    mutationFn: (u: User) =>
      api<{ username: string; email: string | null; temporary_password: string }>(`/users/${u.id}/reset-password`, { method: 'POST' }),
    onSuccess: (r) => setTemp({ username: r.username, email: r.email, password: r.temporary_password }),
  });
  const toggle = useMutation({
    mutationFn: (u: User) => api(`/users/${u.id}`, { method: 'PATCH', json: { is_active: !u.is_active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const unlock = useMutation({
    mutationFn: (u: User) => api(`/users/${u.id}/unlock`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const deptCode = (id: number | null) => depts.data?.find((d) => d.id === id)?.code ?? '';
  const totalPages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.size)) : 1;
  const locked = (u: User) => !!u.locked_until && new Date(u.locked_until) > new Date();

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={users.data ? `${users.data.total} users` : undefined}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9"
            placeholder="Search by name, email or USN"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          className="sm:w-44"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | '');
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          <option value="student">Students</option>
          <option value="faculty">Faculty</option>
          <option value="club">Club organisers</option>
          <option value="admin">Admins</option>
        </Select>
      </div>

      <ErrorText error={users.error || reset.error || toggle.error} />
      {users.isLoading ? (
        <Spinner />
      ) : users.data && users.data.items.length === 0 ? (
        <EmptyState title="No users found">Import a sheet from the Imports page or add a user.</EmptyState>
      ) : (
        <Table head={['User', 'Role', 'Dept', 'Status', 'Last login', '']}>
          {users.data?.items.map((u) => (
            <tr key={u.id}>
              <Td>
                <div className="font-semibold">{u.full_name}</div>
                <div className="text-xs text-muted">{u.email ?? <span className="text-red-600">no email</span>}</div>
                <div className="font-mono text-xs text-muted">{u.username}</div>
              </Td>
              <Td>
                <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role}</Badge>
              </Td>
              <Td>{deptCode(u.department_id)}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {!u.is_active && <Badge tone="red">disabled</Badge>}
                  {locked(u) && <Badge tone="amber">locked</Badge>}
                  {u.must_change_password && <Badge tone="neutral">temp password</Badge>}
                  {u.google_linked && <Badge tone="brand">Google</Badge>}
                  {u.is_active && !locked(u) && !u.must_change_password && <Badge tone="green">active</Badge>}
                </div>
              </Td>
              <Td className="text-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  {locked(u) && (
                    <Button variant="ghost" title="Unlock" onClick={() => unlock.mutate(u)}>
                      <Lock className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" title="Change email" onClick={() => setEditing(u)}>
                    <Mail className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    title="Reset password"
                    onClick={() => {
                      if (confirm(`Reset password for ${u.username}?`)) reset.mutate(u);
                    }}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" onClick={() => toggle.mutate(u)}>
                    {u.is_active ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      <CreateUser open={creating} onClose={() => setCreating(false)} depts={depts.data ?? []} />
      {temp && <TempPassword {...temp} onClose={() => setTemp(null)} />}
      {editing && <EditEmail user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
