import { useEffect, useRef, useState } from 'react';

interface CredentialResponse {
  credential: string;
}

interface GoogleId {
  initialize: (cfg: {
    client_id: string;
    callback: (r: CredentialResponse) => void;
    ux_mode?: 'popup' | 'redirect';
    auto_select?: boolean;
    itp_support?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
  disableAutoSelect: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SRC = 'https://accounts.google.com/gsi/client';
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loading = null;
        reject(new Error('Could not load Google sign-in. Check your connection.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/**
 * Official "Sign in with Google" button (Google Identity Services). Google gives us a signed
 * ID token; the backend verifies it and matches the email to an imported user.
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
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef({ onCredential, onError });
  cb.current = { onCredential, onError };

  useEffect(() => {
    let alive = true;
    loadScript()
      .then(() => {
        if (!alive || !ref.current || !window.google) return;
        const id = window.google.accounts.id;
        id.initialize({
          client_id: clientId,
          callback: (r) => cb.current.onCredential(r.credential),
          ux_mode: 'popup',
          auto_select: false,
          itp_support: true,
        });
        const width = Math.min(400, ref.current.parentElement?.clientWidth ?? 320);
        id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width,
        });
        setReady(true);
      })
      .catch((e: Error) => cb.current.onError(e.message));
    return () => {
      alive = false;
    };
  }, [clientId]);

  return (
    <div className="flex min-h-11 justify-center">
      <div ref={ref} role="group" aria-label="Continue with Google" />
      {!ready && <span className="self-center text-xs text-muted">Loading Google sign-in...</span>}
    </div>
  );
}
