// Usage (stack running, demo accounts seeded): node scripts/web_vitals.mjs [base_url]
// Best against the production build: KEEP=1 SKIP_E2E=1 scripts/prod_smoke.sh. See docs/performance.md.
// Lighthouse-style checks with the Playwright Chromium already installed:
// Web Vitals on a throttled phone (slow 4G, 4x CPU), bytes downloaded, long tasks, and PWA installability.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium, devices } = require('@playwright/test');
const BASE = process.argv[2] ?? 'http://localhost:8088';

const VITALS = `
  window.__v = { lcp: 0, cls: 0, longTasks: 0, longTaskMs: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__v.longTasks++; window.__v.longTaskMs += Math.max(0, e.duration - 50); } }).observe({ type: 'longtask', buffered: true });
`;

const browser = await chromium.launch();

async function measure(name, path, setup) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  if (setup) await setup(ctx);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  // slow 4G as Lighthouse: 150 ms RTT, 1.6 Mbps down, 750 kbps up; 4x slower CPU
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = 0, js = 0, reqs = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; reqs++; });
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => { if (types.get(e.requestId) === 'Script') js += e.encodedDataLength; });
  await page.addInitScript(VITALS);
  const t0 = Date.now();
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const v = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { ...window.__v, fcp: fcp?.startTime ?? 0, ttfb: nav?.responseStart ?? 0, load: nav?.loadEventEnd ?? 0 };
  });
  const row = {
    page: name,
    FCP: `${(v.fcp / 1000).toFixed(2)} s`,
    LCP: `${(v.lcp / 1000).toFixed(2)} s`,
    CLS: v.cls.toFixed(3),
    TBT: `${Math.round(v.longTaskMs)} ms`,
    'JS kB': Math.round(js / 1024),
    'total kB': Math.round(bytes / 1024),
    requests: reqs,
  };
  await ctx.close();
  return row;
}

async function signedIn(email, pw) {
  return async (ctx) => {
    const p = await ctx.newPage();
    await p.goto(BASE + '/login');
    await p.getByLabel('Email').fill(email);
    await p.getByLabel('Password').fill(pw);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForURL((u) => !u.pathname.endsWith('/login'));
    await p.close();
  };
}

const rows = [];
rows.push(await measure('login', '/login'));
rows.push(await measure('student home', '/student', await signedIn('student@openqz.dev', 'Student@2026')));
rows.push(await measure('join', '/join', await signedIn('student@openqz.dev', 'Student@2026')));
rows.push(await measure('faculty home', '/faculty', await signedIn('faculty@openqz.dev', 'Faculty@2026')));
rows.push(await measure('student guide', '/guides/student.html'));
console.table(rows);

// PWA installability: manifest, icons, service worker, offline shell
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
await page.goto(BASE + '/login');
const pwa = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  const m = link ? await (await fetch(link.href)).json() : null;
  const reg = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
  const icons = m?.icons ?? [];
  const iconOk = await Promise.all(icons.map(async (i) => (await fetch(new URL(i.src, location.href))).ok));
  return {
    manifest: !!m, name: m?.name, short_name: m?.short_name, start_url: m?.start_url, display: m?.display,
    theme_color: m?.theme_color, icon_192: icons.some((i) => i.sizes?.includes('192')), icon_512: icons.some((i) => i.sizes?.includes('512')),
    maskable: icons.some((i) => (i.purpose ?? '').includes('maskable')), icons_load: iconOk.every(Boolean),
    service_worker: reg, theme_meta: !!document.querySelector('meta[name="theme-color"]'),
    viewport_meta: !!document.querySelector('meta[name="viewport"]'), lang: document.documentElement.lang, title: document.title,
    description_meta: !!document.querySelector('meta[name="description"]'),
  };
});
console.log('PWA / page meta:', pwa);
await ctx.setOffline(true);
await page.reload().catch(() => {});
console.log('offline reload shows the app shell:', await page.locator('#root').count().then((n) => n > 0).catch(() => false), '| title:', await page.title().catch(() => '-'));
await browser.close();
