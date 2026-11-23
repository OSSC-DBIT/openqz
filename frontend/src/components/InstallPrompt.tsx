import { Download, PlusSquare, Share, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { installEvent, isIos, isStandalone, promptInstall, subscribeInstall } from '../pwa';
import { Button } from './ui';

/* "Install OpenQZ": a small card that offers to add the app to the home screen.

   - Chrome, Edge, Samsung Internet (Android and desktop): one tap opens the browser's install dialog.
   - iPhone and iPad: Safari has no install button for sites, so the card shows the two steps.
   It never shows inside the app once installed, during a quiz, a live game or in the editor, and
   "Not now" keeps it away from this device for two weeks. */

const KEY = 'openqz.install.dismissed';
const QUIET_DAYS = 14;
/** Screens where nothing may cover the content. */
const BUSY = ['/play', '/live', '/faculty/activities', '/join'];

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return Date.now() - at < QUIET_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const event = useSyncExternalStore(subscribeInstall, installEvent, () => null);
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(dismissedRecently);
  // A moment after the page settles, not the instant it opens.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 4000);
    return () => window.clearTimeout(t);
  }, []);

  // Browser tests run with navigator.webdriver set; the card would sit over the buttons they press.
  if (typeof navigator === 'undefined' || navigator.webdriver) return null;
  const ios = isIos();
  const busy = BUSY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!ready || hidden || busy || isStandalone() || (!event && !ios)) return null;

  const close = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* private mode: it just shows again next visit */
    }
    setHidden(true);
  };

  return (
    <div
      role="dialog"
      aria-label="Install OpenQZ"
      className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 animate-rise sticker rounded-lg bg-card p-4 shadow-pop-lg sm:inset-x-auto sm:right-4 sm:w-96 lg:bottom-4"
    >
      <button type="button" onClick={close} aria-label="Not now" className="absolute right-2 top-2 rounded-md p-1.5 text-muted hover:bg-black/5 hover:text-ink">
        <X className="h-4 w-4" aria-hidden />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <img src="/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className="font-bold text-ink">Install OpenQZ</p>
          <p className="mt-0.5 text-sm text-muted">Open it from your home screen like an app: full screen, faster, no address bar.</p>
        </div>
      </div>
      {event ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Not now
          </Button>
          <Button onClick={() => void promptInstall().then((ok) => ok && setHidden(true))}>
            <Download className="h-4 w-4" aria-hidden /> Install
          </Button>
        </div>
      ) : (
        <ol className="mt-3 space-y-1.5 text-sm text-ink">
          <li className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>
            Tap <Share className="h-4 w-4 text-brand-ink" aria-label="Share" /> Share in the browser bar
          </li>
          <li className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>
            Choose <PlusSquare className="h-4 w-4 text-brand-ink" aria-hidden /> <b>Add to Home Screen</b>
          </li>
        </ol>
      )}
    </div>
  );
}
