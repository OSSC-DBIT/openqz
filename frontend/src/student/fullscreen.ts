/**
 * Ask for full screen. Browsers allow it only within a few seconds of a click, so call this
 * synchronously in the click handler, before any network request (not after it returns).
 * Best effort: iPhone browsers have no full screen for web pages, and the player shows a
 * gate with its own button if this did not work.
 */
export function enterFullscreen() {
  if (document.fullscreenElement) return;
  void document.documentElement.requestFullscreen?.().catch(() => {});
}
