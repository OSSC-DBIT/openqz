import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, getAccessToken, setAccessToken } from '../api/client';
import { AuthProvider } from '../auth/AuthProvider';
import { RequireRole } from '../auth/RequireRole';
import { passwordProblem } from '../pages/ChangePasswordPage';
import LoginPage from '../pages/LoginPage';
import { currentAcademicYear } from '../pages/admin/OrgPage';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me = (over = {}) => ({
  id: '1',
  username: '1DB23CS001',
  full_name: 'Asha K',
  email: null,
  role: 'student',
  department_code: 'CSE',
  must_change_password: false,
  google_linked: false,
  ...over,
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
  setAccessToken(null);
});

describe('helpers', () => {
  it('validates passwords like the server', () => {
    expect(passwordProblem('short1A')).toMatch(/8/);
    expect(passwordProblem('alllowercase1')).toMatch(/upper/);
    expect(passwordProblem('NoDigitsHere')).toMatch(/digit/);
    expect(passwordProblem('Good9Password')).toBeNull();
  });

  it('computes the academic year (July rollover)', () => {
    expect(currentAcademicYear(new Date(2026, 10, 8))).toBe('2026-27');
    expect(currentAcademicYear(new Date(2027, 1, 1))).toBe('2026-27');
    expect(currentAcademicYear(new Date(2027, 6, 1))).toBe('2027-28');
  });
});

describe('api client', () => {
  it('refreshes once on 401 and retries the request', async () => {
    setAccessToken('old');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ detail: 'expired' }, 401))
      .mockResolvedValueOnce(json({ access_token: 'new', token_type: 'bearer', expires_in: 900, user: me() }))
      .mockResolvedValueOnce(json({ ok: true }));
    const out = await api<{ ok: boolean }>('/me/sections');
    expect(out.ok).toBe(true);
    expect(getAccessToken()).toBe('new');
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/auth/refresh');
    const retryHeaders = fetchMock.mock.calls[2]![1]!.headers as Headers;
    expect(retryHeaders.get('Authorization')).toBe('Bearer new');
  });

  it('surfaces structured API errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ detail: { code: 'locked', message: 'Account locked, try again in 15 min' } }, 423),
    );
    await expect(api('/auth/login', { method: 'POST', json: {} })).rejects.toMatchObject({
      status: 423,
      code: 'locked',
      message: 'Account locked, try again in 15 min',
    });
  });
});

function renderApp(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/change-password', element: <p>change password page</p> },
      {
        path: '/student',
        element: (
          <RequireRole roles={['student']}>
            <p>student home</p>
          </RequireRole>
        ),
      },
      {
        path: '/admin',
        element: (
          <RequireRole roles={['admin']}>
            <p>admin home</p>
          </RequireRole>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

type Route = (url: string, init?: RequestInit) => Response | undefined;

/** fetch mock that answers by URL; /auth/config defaults to "no Google". */
function mockApi(route: Route) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const hit = route(url, init);
    if (hit) return hit;
    if (url.endsWith('/auth/config'))
      return json({ google_client_id: null, password_login: true, password_reset_email: false, dev_auto_login: false });
    return json({ detail: 'no' }, 401);
  });
}

const token = (over = {}) => json({ access_token: 't', token_type: 'bearer', expires_in: 900, user: me(over) });

describe('routing and auth', () => {
  it('sends anonymous users to login', async () => {
    mockApi(() => undefined);
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('logs in with email and lands on the role home', async () => {
    const fetchMock = mockApi((url) => (url.endsWith('/auth/login') ? token() : undefined));
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'Asha@Example.com ');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'Secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('student home')).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/auth/login'))!;
    expect(JSON.parse(String(loginCall[1]!.body))).toEqual({ email: 'Asha@Example.com', password: 'Secret123' });
  });

  it('signs in automatically when the API enables dev auto login', async () => {
    const fetchMock = mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ detail: 'no session' }, 401);
      if (url.endsWith('/auth/config'))
        return json({ google_client_id: null, password_login: true, password_reset_email: false, dev_auto_login: true });
      if (url.endsWith('/auth/dev-login')) return token({ role: 'admin' });
      return undefined;
    });
    renderApp('/admin');
    expect(await screen.findByText('admin home')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/dev-login'))).toBe(true);
  });

  it('hides the Google button when not configured', async () => {
    mockApi(() => undefined);
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    await waitFor(() => expect(screen.queryByLabelText('Continue with Google')).not.toBeInTheDocument());
  });

  it('shows the Google button when a client id is configured', async () => {
    mockApi((url) =>
      url.endsWith('/auth/config')
        ? json({
            google_client_id: 'abc.apps.googleusercontent.com',
            password_login: true,
            password_reset_email: false,
            dev_auto_login: false,
          })
        : undefined,
    );
    renderApp('/login');
    expect(await screen.findByLabelText('Continue with Google')).toBeInTheDocument();
  });

  it('forces a password change first', async () => {
    mockApi((url) => (url.endsWith('/auth/refresh') ? token({ must_change_password: true }) : undefined));
    renderApp('/student');
    expect(await screen.findByText('change password page')).toBeInTheDocument();
  });

  it('redirects a student away from admin pages', async () => {
    mockApi((url) => (url.endsWith('/auth/refresh') ? token() : undefined));
    renderApp('/admin');
    await waitFor(() => expect(screen.getByText('student home')).toBeInTheDocument());
  });
});
