import { describe, expect, it } from 'vitest';
import { detectBrowser } from '../browser';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  edgeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
  edgeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/130.0.0.0 Mobile/15E148 Safari/605.1.15',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  operaGx: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 OPX/2.6',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  instagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0',
};

describe('detectBrowser (the sign-in page allows Chrome, Safari and Edge)', () => {
  it('knows Chrome on a computer, Android and iPhone', () => {
    expect([UA.chromeWin, UA.chromeAndroid, UA.chromeIphone].map((ua) => detectBrowser(ua))).toEqual(['chrome', 'chrome', 'chrome']);
  });
  it('knows Edge on a computer, Android and iPhone', () => {
    expect([UA.edgeWin, UA.edgeAndroid, UA.edgeIphone].map((ua) => detectBrowser(ua))).toEqual(['edge', 'edge', 'edge']);
  });
  it('knows Safari on Mac and iPhone', () => {
    expect([UA.safariMac, UA.safariIphone].map((ua) => detectBrowser(ua))).toEqual(['safari', 'safari']);
  });
  it('turns away Firefox, Opera, Opera GX, Samsung Internet and in-app browsers', () => {
    for (const ua of [UA.firefox, UA.firefoxIphone, UA.opera, UA.operaGx, UA.samsung, UA.instagram, '']) expect(detectBrowser(ua)).toBe('other');
  });

  // Eruda, Kiwi and in-app web views send Chrome's user agent word for word; the brand list tells them apart.
  const chromium = ['Chromium', 'Not_A Brand'];
  it('turns away Android browsers that only pretend to be Chrome', () => {
    expect(detectBrowser(UA.chromeAndroid, { brands: chromium, mobile: true })).toBe('other');
    expect(detectBrowser(UA.chromeAndroid, { brands: ['Android WebView', ...chromium], mobile: true })).toBe('other');
    expect(detectBrowser(UA.chromeWin, { brands: ['Brave', ...chromium], mobile: false })).toBe('other');
  });
  it('lets real Chrome and Edge through by their brand', () => {
    expect(detectBrowser(UA.chromeAndroid, { brands: ['Google Chrome', ...chromium], mobile: true })).toBe('chrome');
    expect(detectBrowser(UA.edgeAndroid, { brands: ['Microsoft Edge', ...chromium], mobile: true })).toBe('edge');
    expect(detectBrowser(UA.chromeWin, { brands: ['Google Chrome', ...chromium], mobile: false })).toBe('chrome');
  });
  it('allows plain Chromium on a computer, and our own browser tests', () => {
    expect(detectBrowser(UA.chromeWin, { brands: chromium, mobile: false })).toBe('chrome');
    expect(detectBrowser(UA.chromeAndroid, { brands: chromium, mobile: true, automated: true })).toBe('chrome');
    // automation does not unlock a browser that says it is something else
    expect(detectBrowser(UA.firefox, { brands: chromium, mobile: true, automated: true })).toBe('other');
  });
});
