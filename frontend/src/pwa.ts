/* Installing OpenQZ as an app (PWA).

   Chrome, Edge and Samsung Internet fire `beforeinstallprompt` when the app can be installed;
   it can fire before React has mounted, so this module (imported first by main.tsx) keeps it.
   Safari on iPhone and iPad has no such event: there the user adds the app from the Share menu,
   and the install card shows those steps instead. */

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // the app shows its own card instead of the browser's mini bar
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    changed();
  });
}

/** Snapshot for useSyncExternalStore: the waiting install event, or null. */
export const installEvent = (): InstallPromptEvent | null => deferred;
export const justInstalled = (): boolean => installed;

export function subscribeInstall(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Shows the browser's install dialog. True when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  changed();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

/** Already running as the installed app. */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
