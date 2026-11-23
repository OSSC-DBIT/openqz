import type { Me, TokenResponse } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<TokenResponse | null> | null = null;
const listeners = new Set<(me: Me | null) => void>();
let playerSession: string | null = null;

/**
 * The quiz player names its browser tab while an attempt is open; the server uses it to notice
 * the same attempt being worked on from a second tab or device. Null when no attempt is open.
 */
export function setPlayerSession(id: string | null): void {
  playerSession = id;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Notified when a refresh changes the user (or logs them out). */
export function onSessionChange(fn: (me: Me | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'error';
  let message = res.statusText || 'Request failed';
  try {
    const body = await res.json();
    const d = body?.detail;
    if (typeof d === 'string') message = d;
    else if (d && typeof d === 'object' && 'message' in d) {
      message = d.message;
      code = d.code ?? code;
    } else if (Array.isArray(d) && d[0]?.msg) {
      message = d.map((e: { loc?: string[]; msg: string }) => `${e.loc?.slice(-1)[0] ?? ''}: ${e.msg}`).join('; ');
      code = 'validation';
    }
  } catch {
    /* not json */
  }
  return new ApiError(res.status, code, message);
}

export async function refreshSession(): Promise<TokenResponse | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' });
        if (!res.ok) {
          // Only "your session is over" signs the user out. A busy or restarting server (502
          // during a deploy, 429) must not throw a student out of a quiz: keep the session and
          // let the next request try again.
          if (res.status === 401 || res.status === 403) {
            accessToken = null;
            listeners.forEach((l) => l(null));
          }
          return null;
        }
        const body = (await res.json()) as TokenResponse;
        accessToken = body.access_token;
        listeners.forEach((l) => l(body.user));
        return body;
      } catch {
        return null; // offline for a moment
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  body?: BodyInit;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const headers = new Headers(opts.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (playerSession && path.startsWith('/attempts/')) headers.set('X-Player-Session', playerSession);
  let body = opts.body;
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`/api/v1${path}`, { ...opts, headers, body, credentials: 'same-origin' });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, opts, false);
  }
  if (!res.ok) throw await parseError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Headers for code that calls fetch itself (e.g. the guard reporter). */
export function authHeaders(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
