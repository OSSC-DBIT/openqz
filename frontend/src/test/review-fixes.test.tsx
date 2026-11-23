import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshSession, setAccessToken, getAccessToken } from '../api/client';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { useConfirm } from '../components/Confirm';
import { firstName, fmtWhen } from '../components/quiz';
import { Button } from '../components/ui';

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

const me = (id: string) => ({ id, username: id, full_name: id, email: `${id}@x.dev`, role: 'student', department_code: null, must_change_password: false, google_linked: false });
const tokenFor = (id: string) => new Response(JSON.stringify({ access_token: `t-${id}`, token_type: 'bearer', expires_in: 900, user: me(id) }), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('Button', () => {
  it('cannot be clicked while loading, even when the caller also passes disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button loading disabled={false} onClick={onClick}>
        Assign
      </Button>,
    );
    const b = screen.getByRole('button', { name: /Assign/ });
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stays disabled when the caller disables it', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('names and dates', () => {
  it('greets by the first real name, not the title', () => {
    expect(firstName('Dr. Meera Rao')).toBe('Meera');
    expect(firstName('Prof Anil Kumar')).toBe('Anil');
    expect(firstName('Asha')).toBe('Asha');
    expect(firstName('Dr.')).toBe('Dr.');
    expect(firstName(undefined)).toBe('');
  });

  it('shows a date without seconds', () => {
    const text = fmtWhen(new Date(new Date().getFullYear(), 10, 23, 10, 58, 55).toISOString());
    expect(text).toMatch(/23/);
    expect(text).not.toMatch(/55/);
    expect(fmtWhen(null)).toBe('');
  });
});

describe('session', () => {
  it('keeps the user signed in when the refresh fails because the server is busy', async () => {
    setAccessToken('still-good');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })));
    expect(await refreshSession()).toBeNull();
    expect(getAccessToken()).toBe('still-good');
  });

  it('signs out when the server says the session is over', async () => {
    setAccessToken('old');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await new Promise((r) => setTimeout(r, 5)); // the previous refresh promise is released on the next tick
    expect(await refreshSession()).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('empties cached data when another person signs in on the same tab', async () => {
    const qc = new QueryClient();
    let next = 'asha';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/auth/refresh')) return new Response('{}', { status: 401 });
        if (String(url).endsWith('/auth/login')) return tokenFor(next);
        return new Response(null, { status: 204 });
      }),
    );
    function Probe() {
      const { user, login, logout } = useAuth();
      return (
        <>
          <p>user:{user?.id ?? 'none'}</p>
          <button onClick={() => void login('a', 'b')}>in</button>
          <button onClick={() => void logout()}>out</button>
        </>
      );
    }
    await new Promise((r) => setTimeout(r, 5));
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByText('in'));
    await screen.findByText('user:asha');
    qc.setQueryData(['me', 'activities'], { pending: ['asha only'] });

    await userEvent.click(screen.getByText('out'));
    await screen.findByText('user:none');
    expect(qc.getQueryData(['me', 'activities'])).toBeUndefined();

    next = 'bharath';
    await userEvent.click(screen.getByText('in'));
    await screen.findByText('user:bharath');
    await waitFor(() => expect(qc.getQueryData(['me', 'activities'])).toBeUndefined());
  });
});

describe('useConfirm', () => {
  it('answers yes or no from our own dialog', async () => {
    const got: boolean[] = [];
    function Probe() {
      const [ask, dialog] = useConfirm();
      return (
        <>
          <button onClick={() => void ask({ title: 'End the game?', action: 'End game' }).then((ok) => got.push(ok))}>ask</button>
          {dialog}
        </>
      );
    }
    render(<Probe />);
    await userEvent.click(screen.getByText('ask'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByText('ask'));
    await userEvent.click(screen.getByRole('button', { name: 'End game' }));
    await waitFor(() => expect(got).toEqual([false, true]));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
