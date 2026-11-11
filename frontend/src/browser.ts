export type Browser = 'chrome' | 'edge' | 'safari' | 'other';

/** Browsers built on Chrome or Safari that are not one of the three we support, and in-app browsers. */
const OTHER = /Firefox|FxiOS|OPR\/|Opera|OPT\/|SamsungBrowser|UCBrowser|YaBrowser|Vivaldi|DuckDuckGo|MiuiBrowser|HuaweiBrowser|Brave|; wv\)|FBAN|FBAV|Instagram|Line\//;

/**
 * Which browser this is, from its user agent. OpenQZ is tested on Chrome, Safari and
 * Microsoft Edge (computer, Android, iPhone); the sign-in page asks everyone else to switch.
 * This is a guide for honest users, not a lock: a user agent can be faked.
 */
export function detectBrowser(ua: string): Browser {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (OTHER.test(ua)) return 'other';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua) && /Macintosh|iPhone|iPad|iPod/.test(ua)) return 'safari';
  return 'other';
}

export function currentBrowser(): Browser {
  if (typeof navigator === 'undefined') return 'other';
  // Brave sends Chrome's user agent; it says who it is here.
  if ('brave' in navigator) return 'other';
  return detectBrowser(navigator.userAgent);
}

export const isSupportedBrowser = () => currentBrowser() !== 'other';
