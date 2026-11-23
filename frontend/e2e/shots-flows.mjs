// Design review of screens that need a click to reach (mock API): node e2e/shots-flows.mjs <baseUrl> <outDir>
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { mockApi } from './mock-api.mjs';

const [base = 'http://localhost:5199', out = 'shots'] = process.argv.slice(2);
const DIM = { watch: [240, 420], phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900] };
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, overflow > 1 ? `OVERFLOW ${overflow}px` : 'ok');
}

for (const size of (process.env.SIZES ?? 'phone,desktop').split(',')) {
  const [width, height] = DIM[size];
  const dark = !!process.env.DARK;
  const sfx = `${size}${dark ? '-dark' : ''}`;
  const open = async (role, path) => {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => !/WebSocket/.test(e.message) && console.log(`[pageerror ${size}]`, e.message));
    await mockApi(page, role);
    await page.goto(base + path);
    await page.waitForLoadState('networkidle').catch(() => {});
    return page;
  };

  let page = await open('faculty', '/faculty/activities/a1');
  await page.getByRole('button', { name: 'Edit question 1' }).click();
  await shot(page, `flow-question-editor-${sfx}`);
  await page.close();

  page = await open('faculty', '/faculty/activities/a1');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await shot(page, `flow-import-source-${sfx}`);
  await page.getByRole('tab', { name: /Paste text/ }).click();
  await page.getByRole('button', { name: 'Fill in an example' }).click();
  await page.getByRole('button', { name: 'Read questions' }).click();
  await shot(page, `flow-import-review-${sfx}`);
  await page.close();

  page = await open('faculty', '/faculty/activities/a1?assign=1');
  await shot(page, `flow-assign-${sfx}`);
  await page.close();

  page = await open('student', '/play/att1');
  await shot(page, `flow-player-${sfx}`);
  await page.close();

  page = await open('student', '/join');
  await shot(page, `flow-join-${sfx}`);
  await page.close();
}
await browser.close();
