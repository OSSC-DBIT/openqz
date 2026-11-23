import { useEffect, useRef, useState } from 'react';

/**
 * The official "Sign in with Google" button (Google Identity Services), shown in a frame
 * (public/google-signin.html). Google's library adds inline styles, which the app's content
 * security policy does not allow; the frame page is the only page that does, so Google's script
 * never runs in the app itself. Google gives the frame a signed ID token; the frame passes it here
 * by postMessage (same origin only), and the backend verifies it and matches the email to an
 * imported user.
 */
export function GoogleButton({
  clientId,
  onCredential,
  onError,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const cb = useRef({ onCredential, onError });
  cb.current = { onCredential, onError };

  useEffect(() => {
    setWidth(Math.round(Math.min(400, box.current?.clientWidth ?? 320)));
  }, []);

  useEffect(() => {
    const listen = (e: MessageEvent) => {
      // only our own frame, on our own origin
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { source?: string; credential?: string; error?: string; ready?: boolean } | null;
      if (!d || d.source !== 'openqz-google') return;
      if (d.ready) setReady(true);
      if (typeof d.credential === 'string' && d.credential) cb.current.onCredential(d.credential);
      if (typeof d.error === 'string') cb.current.onError(d.error);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  return (
    <div ref={box} className="relative flex min-h-11 justify-center">
      {width !== null && (
        <iframe
          ref={frame}
          title="Continue with Google"
          src={`/google-signin.html?client_id=${encodeURIComponent(clientId)}&width=${width}`}
          className="h-11 w-full max-w-[400px] border-0"
          loading="eager"
        />
      )}
      {!ready && <span className="absolute inset-0 grid place-items-center text-xs text-muted">Loading Google sign-in...</span>}
    </div>
  );
}
