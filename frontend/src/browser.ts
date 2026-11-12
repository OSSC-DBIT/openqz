export type Browser = 'chrome' | 'edge' | 'safari' | 'other';

/** Browsers built on Chrome or Safari that are not one of the three we support, and in-app browsers. */
const OTHER = /Firefox|FxiOS|OPR\/|OPX\/|Opera|OPT\/|SamsungBrowser|UCBrowser|YaBrowser|Vivaldi|DuckDuckGo|MiuiBrowser|HuaweiBrowser|Brave|; wv\)|FBAN|FBAV|Instagram|Line\//;

/** Brand names (from the browser's own brand list) of Chromium browsers we do not support. */
const OTHER_BRAND = /Brave|Opera|Vivaldi|Yandex|YaBrowser|Samsung|DuckDuckGo|WebView|Whale|UC ?Browser|Kiwi|Eruda/i;

/** What a Chromium browser says about itself besides the user agent (navigator.userAgentData). */
export interface BrandInfo {
  brands: string[];
  mobile: boolean;
  /** Driven by test automation (navigator.webdriver): our own browser tests. */
  automated?: boolean;
}

/**
 * Which browser this is. OpenQZ is tested on Chrome, Safari and Microsoft Edge (computer,
 * Android, iPhone); the sign-in page asks everyone else to switch.
 *
 * Many Android browsers (Eruda, Kiwi, in-app web views) send Chrome's user agent word for
 * word, so the user agent alone cannot tell them apart. Chromium browsers also publish a
 * brand list: real Chrome says "Google Chrome", Edge says "Microsoft Edge", the others say
 * only "Chromium" or their own name. On phones we require one of the two real brands.
 *
 * This is a guide for honest users, not a lock: both values can be faked.
 */
export function detectBrowser(ua: string, info?: BrandInfo): Browser {
  if (info?.brands.length) {
    const names = info.brands;
    if (names.some((b) => OTHER_BRAND.test(b))) return 'other';
    if (names.includes('Microsoft Edge')) return 'edge';
    if (names.includes('Google Chrome')) return OTHER.test(ua) ? 'other' : 'chrome';
    // "Chromium" only. On a phone that is a Chrome look-alike; on a computer it is the open
    // Chromium many Linux labs use, which behaves like Chrome.
    if (info.mobile && !info.automated) return 'other';
  }
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
  const data = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; mobile?: boolean } }).userAgentData;
  const info = data?.brands ? { brands: data.brands.map((b) => b.brand), mobile: !!data.mobile, automated: navigator.webdriver === true } : undefined;
  return detectBrowser(navigator.userAgent, info);
}

export const isSupportedBrowser = () => currentBrowser() !== 'other';
