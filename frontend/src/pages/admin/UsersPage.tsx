import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { Department, Page, Role, Section, User } from '../../api/types';
import { DeleteForever } from '../../components/DeleteForever';
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
  cx,
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

interface UserForm {
  username: string;
  full_name: string;
  email: string;
  phone: string;
  designation: string;
  role: Role;
  /** Main department first. Faculty may have several. */
  department_ids: number[];
  section_id: string;
}

const EMPTY: UserForm = { username: '', full_name: '', email: '', phone: '', designation: '', role: 'student', department_ids: [], section_id: '' };

const ROLE_HINT: Record<Role, string> = {
  student: 'Takes quizzes and assignments given to their section.',
  faculty: 'Builds activities and assigns them to the classes mapped to them.',
  club: 'Builds activities and hosts rooms and live games with a join code. No class lists.',
  admin: 'Manages users, sections, imports and sees every report.',
};

/** The fields shared by "Add user" and "Edit user". */
function UserFields({ form, set, depts, sections, creating }: { form: UserForm; set: (f: UserForm) => void; depts: Department[]; sections: Section[]; creating: boolean }) {
  const isStudent = form.role === 'student';
  const isFaculty = form.role === 'faculty';
  const toggleDept = (id: number) =>
    set({ ...form, department_ids: form.department_ids.includes(id) ? form.department_ids.filter((x) => x !== id) : [...form.department_ids, id] });
  const main = form.department_ids[0];
  // Sections of the chosen department first; all of them when no department is chosen.
  const shownSections = sections.filter((x) => !main || x.department_id === main || String(x.id) === form.section_id);
  return (
    <>
      {creating && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username (USN / employee ID)">
            <Input required minLength={2} maxLength={64} pattern="[A-Za-z0-9._\-]+" title="Letters, digits, dot, dash or underscore" value={form.username} onChange={(e) => set({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Role" hint={ROLE_HINT[form.role]}>
            <Select value={form.role} onChange={(e) => set({ ...form, role: e.target.value as Role, department_ids: form.department_ids.slice(0, 1), section_id: '' })}>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="club">Club organiser</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
      )}
      <Field label="Full name">
        <Input required maxLength={200} value={form.full_name} onChange={(e) => set({ ...form, full_name: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email (used to sign in)">
          <Input type="email" required value={form.email} onChange={(e) => set({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Phone (optional)">
          <Input type="tel" inputMode="tel" maxLength={20} placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set({ ...form, phone: e.target.value })} />
        </Field>
      </div>
      {!isStudent && (
        <Field label={form.role === 'club' ? 'Club and position (optional)' : 'Designation (optional)'}>
          <Input maxLength={120} placeholder={form.role === 'club' ? 'Coding Club, coordinator' : 'Assistant Professor'} value={form.designation} onChange={(e) => set({ ...form, designation: e.target.value })} />
        </Field>
      )}
      {isFaculty ? (
        <div className="space-y-1.5">
          <div className="text-sm font-medium text-ink" id="dept-group">
            Departments
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="dept-group">
            {depts.map((d) => {
              const on = form.department_ids.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={on}
                  title={d.name}
                  onClick={() => toggleDept(d.id)}
                  className={cx('rounded-full border px-3 py-1 text-sm', on ? 'border-brand-600 bg-brand-600 font-semibold text-white' : 'border-line hover:border-brand-500')}
                >
                  {d.code}
                  {on && d.id === main && form.department_ids.length > 1 ? ' (main)' : ''}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">Pick every department this teacher works in. The first one you pick is the main department.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Department">
            <Select value={main ?? ''} onChange={(e) => set({ ...form, department_ids: e.target.value ? [Number(e.target.value)] : [], section_id: '' })}>
              <option value="">None</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </Select>
          </Field>
          {isStudent && (
            <Field label="Section" hint="Needed to receive class assignments.">
              <Select value={form.section_id} onChange={(e) => set({ ...form, section_id: e.target.value })}>
                <option value="">None</option>
                {shownSections.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.department_code} Sem {x.semester} {x.name} ({x.academic_year})
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}
    </>
  );
}

/** What the API takes for the shared fields. */
function userPayload(form: UserForm) {
  return {
    full_name: form.full_name.trim(),
    email: form.email.trim().toLowerCase(),
    phone: form.phone.trim() || null,
    designation: form.role === 'student' ? null : form.designation.trim() || null,
    department_ids: form.department_ids,
    ...(form.role === 'student' ? { section_id: form.section_id ? Number(form.section_id) : null } : {}),
  };
}

function CreateUser({ open, onClose, depts, sections }: { open: boolean; onClose: () => void; depts: Department[]; sections: Section[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<UserForm>(EMPTY);
  const [created, setCreated] = useState<{ username: string; email: string | null; password: string } | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api<{ user: User; temporary_password: string }>('/users', {
        method: 'POST',
        json: { username: form.username.trim().toUpperCase(), role: form.role, ...userPayload(form) },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setCreated({ username: r.user.username, email: r.user.email, password: r.temporary_password });
      setForm(EMPTY);
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
      <form onSubmit={submit} className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
        <UserFields form={form} set={setForm} depts={depts} sections={sections} creating />
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

function EditUser({ user, onClose, depts, sections }: { user: User; onClose: () => void; depts: Department[]; sections: Section[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<UserForm>({
    username: user.username,
    full_name: user.full_name,
    email: user.email ?? '',
    phone: user.phone ?? '',
    designation: user.designation ?? '',
    role: user.role,
    department_ids: user.department_ids,
    section_id: user.section_id ? String(user.section_id) : '',
  });
  const save = useMutation({
    mutationFn: () => api(`/users/${user.id}`, { method: 'PATCH', json: userPayload(form) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Edit ${user.full_name}`}>
      <form
        className="max-h-[75vh] space-y-3 overflow-y-auto pr-1"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">
          <span className="font-mono">{user.username}</span> | {user.role === 'club' ? 'club organiser' : user.role}
          {user.google_linked ? ' | changing the email unlinks their Google account' : ''}
        </p>
        <UserFields form={form} set={setForm} depts={depts} sections={sections} creating={false} />
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

interface Impact {
  username: string;
  attempts: number;
  activities: number;
  assignments: number;
  attempts_by_students: number;
  live_games: number;
  blocked_by: string | null;
}

/** Delete a person for good: first show what goes with them. */
function DeleteUser({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const impact = useQuery({ queryKey: ['user-impact', user.id], queryFn: () => api<Impact>(`/admin/data/users/${user.id}/impact`), staleTime: 0 });
  const i = impact.data;
  if (!i) {
    return (
      <Modal open onClose={onClose} title={`Delete ${user.full_name}`}>
        {impact.error ? <ErrorText error={impact.error} /> : <Spinner />}
      </Modal>
    );
  }
  return (
    <DeleteForever
      title={`Delete ${user.full_name}`}
      endpoint={`/admin/data/users/${user.id}/delete`}
      confirmWord={user.username}
      blocked={i.blocked_by}
      onClose={onClose}
      onDone={() => {
        void qc.invalidateQueries({ queryKey: ['users'] });
        onClose();
      }}
    >
      <p className="mt-1">This removes the account of {user.full_name} and:</p>
      <ul className="mt-1 list-inside list-disc">
        <li>
          {i.attempts} of their own attempts (answers and marks)
        </li>
        {(i.activities > 0 || i.live_games > 0) && (
          <li>
            {i.activities} activities they made, with {i.assignments} assignments and <b>{i.attempts_by_students} attempts by students</b>
          </li>
        )}
        {i.live_games > 0 && <li>{i.live_games} live games they hosted</li>}
      </ul>
      <p className="mt-1">To stop someone signing in but keep their work, use Disable instead.</p>
    </DeleteForever>
  );
}

function UserStatus({ u, locked }: { u: User; locked: boolean }) {
  return (
    <>
      {!u.is_active && <Badge tone="red">disabled</Badge>}
      {locked && <Badge tone="amber">locked</Badge>}
      {u.must_change_password && <Badge tone="neutral">temp password</Badge>}
      {u.google_linked && <Badge tone="brand">Google</Badge>}
      {u.is_active && !locked && !u.must_change_password && <Badge tone="green">active</Badge>}
    </>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role | ''>('');
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [temp, setTemp] = useState<{ username: string; email: string | null; password: string } | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });
  const sections = useQuery({ queryKey: ['sections', 'all'], queryFn: () => api<Section[]>('/sections') });
  const params = new URLSearchParams({ page: String(page), size: '50' });
  if (role) params.set('role', role);
  if (dept) params.set('department_id', dept);
  if (q.trim()) params.set('q', q.trim());
  const users = useQuery({
    queryKey: ['users', role, dept, q, page],
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

  const deptCodes = (u: User) => u.department_ids.map((id) => depts.data?.find((d) => d.id === id)?.code).filter(Boolean).join(', ');
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
            placeholder="Search by name, email, phone or USN"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          className="sm:w-44"
          aria-label="Filter by role"
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
        <Select
          className="sm:w-44"
          aria-label="Filter by department"
          value={dept}
          onChange={(e) => {
            setDept(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All departments</option>
          {depts.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </Select>
      </div>

      <ErrorText error={users.error || reset.error || toggle.error} />
      {users.isLoading ? (
        <Spinner />
      ) : users.data && users.data.items.length === 0 ? (
        <EmptyState title="No users found">Import a sheet from the Imports page or add a user.</EmptyState>
      ) : (
        <Table
          head={['User', 'Role', 'Dept / section', 'Status', 'Last login', '']}
          cols={[undefined, 'hidden sm:table-cell', 'hidden md:table-cell', 'hidden sm:table-cell', 'hidden xl:table-cell', 'w-px']}
          compact
        >
          {users.data?.items.map((u) => (
            <tr key={u.id}>
              <Td>
                <div className="font-semibold">{u.full_name}</div>
                <div className="break-all text-xs text-muted">{u.email ?? <span className="text-red-600">no email</span>}</div>
                <div className="break-all font-mono text-xs text-muted">{u.username}</div>
                {(u.designation || u.phone) && <div className="text-xs text-muted">{[u.designation, u.phone].filter(Boolean).join(' | ')}</div>}
                <div className="text-xs text-muted md:hidden">{[deptCodes(u), u.section_label].filter(Boolean).join(' | ')}</div>
                {/* phones: role and status under the name (their columns are hidden) */}
                <div className="mt-1.5 flex flex-wrap gap-1 sm:hidden">
                  <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role}</Badge>
                  <UserStatus u={u} locked={locked(u)} />
                </div>
              </Td>
              <Td className="hidden sm:table-cell">
                <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role}</Badge>
              </Td>
              <Td className="hidden md:table-cell">
                {deptCodes(u)}
                {u.section_label && <div className="text-xs text-muted">{u.section_label}</div>}
              </Td>
              <Td className="hidden sm:table-cell">
                <div className="flex flex-wrap gap-1">
                  <UserStatus u={u} locked={locked(u)} />
                </div>
              </Td>
              <Td className="hidden text-muted xl:table-cell">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}</Td>
              <Td>
                {/* phones: a 2 x 2 grid of actions; wider screens: one row */}
                <div className="grid grid-cols-[auto_auto] justify-end gap-1 sm:flex sm:justify-end [&>button]:!px-2.5">
                  {locked(u) && (
                    <Button variant="ghost" title="Unlock" aria-label={`Unlock ${u.username}`} onClick={() => unlock.mutate(u)}>
                      <Lock className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" title="Edit details" aria-label={`Edit details of ${u.username}`} onClick={() => setEditing(u)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    title="Reset password"
                    aria-label={`Reset password for ${u.username}`}
                    onClick={() => {
                      if (confirm(`Reset password for ${u.username}?`)) reset.mutate(u);
                    }}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" onClick={() => toggle.mutate(u)}>
                    {u.is_active ? 'Disable' : 'Enable'}
                  </Button>
                  <Button variant="ghost" title="Delete for good" aria-label={`Delete ${u.username} for good`} className="hover:!bg-red-50 hover:!text-red-700 dark:hover:!bg-red-950" onClick={() => setDeleting(u)}>
                    <Trash2 className="h-4 w-4" />
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

      <CreateUser open={creating} onClose={() => setCreating(false)} depts={depts.data ?? []} sections={sections.data ?? []} />
      {temp && <TempPassword {...temp} onClose={() => setTemp(null)} />}
      {deleting && <DeleteUser user={deleting} onClose={() => setDeleting(null)} />}
      {editing && <EditUser user={editing} onClose={() => setEditing(null)} depts={depts.data ?? []} sections={sections.data ?? []} />}
    </>
  );
}
