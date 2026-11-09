import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Logo } from '../layouts/AppShell';
import NotFound from './NotFound';

const RELOAD_KEY = 'openqz-chunk-reload';

/** A page's code file could not be downloaded, usually because the app was updated while this tab was open. */
export function isChunkError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|ChunkLoadError/i.test(msg);
}

/**
 * Shown instead of React Router's raw error screen. After an update, a stale tab asks for page files
 * that no longer exist; reload once to pick up the new version.
 */
export default function RouteError() {
  const err = useRouteError();
  const chunk = isChunkError(err);

  useEffect(() => {
    if (!chunk) return;
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, '1');
    } catch {
      return;
    }
    window.location.reload();
  }, [chunk]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* ignore */
      }
    }, 10_000);
    return () => window.clearTimeout(t);
  }, []);

  if (isRouteErrorResponse(err) && err.status === 404) return <NotFound />;

  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-4">
      <div className="w-full max-w-md rounded-3xl border border-line bg-card p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 text-xl font-extrabold">{chunk ? 'OpenQZ was updated' : 'Something went wrong'}</h1>
        <p className="mt-2 text-sm text-muted">
          {chunk ? 'Reload to get the latest version. Your answers are saved on the server.' : 'This page hit an unexpected problem. Reloading usually fixes it.'}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 font-bold text-white hover:bg-brand-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Reload
          </button>
          <Link to="/login" reloadDocument className="inline-flex items-center justify-center rounded-xl border border-line px-5 py-2.5 font-semibold hover:bg-brand-50">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
