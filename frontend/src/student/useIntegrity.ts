import { useEffect, useRef } from 'react';
import { api } from '../api/client';

export interface ViolationResult {
  violations: number;
  max: number;
  submitted: boolean;
  /** why the attempt ended, when submitted: only 'violations' means the warnings did it */
  submit_reason?: string | null;
}

const LABEL: Record<string, string> = {
  visibility_hidden: 'You left the quiz (switched tab or app, or locked the screen).',
  focus_lost: 'The quiz window lost focus.',
  back_navigation: 'You pressed Back.',
  page_reloaded: 'The page was reloaded or reopened.',
  fullscreen_exit: 'You left full screen.',
};
export const violationText = (kind: string) => LABEL[kind] ?? 'A quiz rule was broken.';

const flagKey = (attemptId: string) => `oqz-active-${attemptId}`;

/** Mark the attempt as finished so a later visit is not seen as a reload. */
export function clearIntegrityFlag(attemptId: string) {
  try {
    sessionStorage.removeItem(flagKey(attemptId));
  } catch {
    /* private mode */
  }
}

/**
 * Exam integrity for the player. Detects leaving the page and reports each incident to the
 * server, which counts violations and auto-submits at the limit. Incidents within 2 s count
 * once (a tab switch fires blur + hidden together). A focus loss shorter than 1.5 s
 * (notification shade flick) is ignored.
 */
export function useIntegrity(
  attemptId: string | undefined,
  enabled: boolean,
  onResult: (kind: string, r: ViolationResult) => void,
) {
  const cb = useRef(onResult);
  cb.current = onResult;

  useEffect(() => {
    if (!attemptId || !enabled) return;
    const sessionId = `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    let last = 0;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    let paused = false;

    const report = (kind: string, meta?: Record<string, unknown>) => {
      if (paused) return;
      const now = Date.now();
      if (now - last < 2000) return;
      last = now;
      api<ViolationResult>(`/attempts/${attemptId}/violations`, {
        method: 'POST',
        json: { kind, session_id: sessionId, meta },
        keepalive: true,
      })
        .then((r) => cb.current(kind, r))
        .catch(() => {
          /* offline: the server-side deadline still applies */
        });
    };

    // reload / reopen mid-attempt
    try {
      if (sessionStorage.getItem(flagKey(attemptId))) report('page_reloaded');
      sessionStorage.setItem(flagKey(attemptId), '1');
    } catch {
      /* ignore */
    }

    const onVis = () => {
      if (document.visibilityState === 'hidden') report('visibility_hidden');
    };
    const onBlur = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!document.hasFocus() && document.visibilityState === 'visible') report('focus_lost');
      }, 1500);
    };
    const onFocus = () => {
      if (blurTimer) clearTimeout(blurTimer);
    };

    // Back button / back gesture trap (re-armed on the next tap: Chrome skips entries
    // added without a user gesture).
    let armed = false;
    const arm = () => {
      if (armed) return;
      history.pushState({ oqzTrap: true }, '', location.href);
      armed = true;
    };
    arm();
    const onPop = () => {
      armed = false;
      report('back_navigation');
      arm();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onFs = () => {
      if (!document.fullscreenElement) report('fullscreen_exit');
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'f5' || ((e.ctrlKey || e.metaKey) && k === 'r')) e.preventDefault();
      arm();
    };
    // File pickers and permission prompts blur the window on purpose.
    const onPauseReq = (e: Event) => {
      paused = (e as CustomEvent<boolean>).detail;
    };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('oqz-integrity-pause', onPauseReq);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('oqz-integrity-pause', onPauseReq);
      if (blurTimer) clearTimeout(blurTimer);
      // drop our extra history entry so normal Back works after the attempt
      if ((history.state as { oqzTrap?: boolean } | null)?.oqzTrap) history.back();
    };
  }, [attemptId, enabled]);
}
