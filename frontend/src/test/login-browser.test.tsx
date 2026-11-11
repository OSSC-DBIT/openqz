import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import LoginPage from '../pages/LoginPage';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../api/client', async (original) => ({ ...await original<typeof import('../api/client')>(), api: () => Promise.resolve({}) }));

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

function show(from?: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36 OPX/2.6');
  window.history.replaceState(null, '', '/login?room=123456');
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[{ pathname: '/login', state: { from } }]}><LoginPage /></MemoryRouter></QueryClientProvider>);
}

it('asks Android Opera GX visitors to switch and keeps guest joining available', () => {
  show();
  expect(screen.getByRole('heading', { name: 'Open OpenQZ in Chrome, Safari or Edge' })).toBeVisible();
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Join a live game as a guest' })).toHaveAttribute('href', '/live');
});

it.each([undefined, 'https://elsewhere.example/room', '/\\elsewhere.example/room', 'http://['])('copies the current path and query for an absent or unsafe destination: %s', async (from) => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
  show(from);
  fireEvent.click(screen.getByRole('button', { name: 'Copy the address' }));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/login?room=123456`);
});

it('preserves a room destination and its query when copying', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
  show('/join/123456?source=invite');
  fireEvent.click(screen.getByRole('button', { name: 'Copy the address' }));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/123456?source=invite`);
});

it.each(['missing', 'rejected'])('explains manual copying when clipboard access is %s', async (mode) => {
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(mode === 'missing' ? undefined as unknown as Clipboard : { writeText: vi.fn().mockRejectedValue(new Error('denied')) } as unknown as Clipboard);
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Copy the address' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Press and hold the address above, choose Copy');
  expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
});
