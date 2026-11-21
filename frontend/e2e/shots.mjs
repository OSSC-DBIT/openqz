// Screenshots for design review (not a test): node e2e/shots.mjs <baseUrl> <outDir> [role] [paths...]
// MOCK=1 uses a fake API (e2e/mock-api.mjs), so no backend is needed.
// role: none | admin | faculty | student | club. Sizes: watch 240, phone 390, tablet 820, desktop 1440.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { mockApi } from './mock-api.mjs';

const [base = 'http://localhost:8088', out = 'shots', role = 'none', ...paths] = process.argv.slice(2);
const USERS = {
  admin: [process.env.ADMIN_EMAIL ?? 'admin@openqz.dev', process.env.ADMIN_PASSWORD ?? 'Admin2026Secure'],
  faculty: ['faculty@openqz.dev', 'Faculty@2026'],
  student: ['student@openqz.dev', 'Student@2026'],
  club: [process.env.CLUB_EMAIL ?? 'club@openqz.dev', process.env.CLUB_PASSWORD ?? 'Club@2026'],
};
const SIZES = (process.env.SIZES ?? 'phone,desktop').split(',');
const DIM = { watch: [240, 420], phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900], wide: [2560, 1300] };

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const size of SIZES) {
  const [width, height] = DIM[size];
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: process.env.DARK ? 'dark' : 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror ${size}]`, e.message));
  if (process.env.MOCK) await mockApi(page, role);
  else if (role !== 'none') {
    const [email, password] = USERS[role];
    await page.goto(`${base}/login`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  }
  for (const p of paths) {
    await page.goto(base + p);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(400);
    const name = `${role}-${p.replace(/[^a-z0-9]+/gi, '_') || 'home'}-${size}${process.env.DARK ? '-dark' : ''}.png`;
    await page.screenshot({ path: `${out}/${name}`, fullPage: process.env.FULL !== '0' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(name, overflow > 1 ? `OVERFLOW ${overflow}px` : 'ok');
  }
  await ctx.close();
}
await browser.close();
