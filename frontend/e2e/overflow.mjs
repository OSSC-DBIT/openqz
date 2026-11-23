// Which elements stick out of the page? node e2e/overflow.mjs <baseUrl> <role> <width> <path...>  (mock API)
import { chromium } from '@playwright/test';
import { mockApi } from './mock-api.mjs';
const [base, role, width, ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: Number(width), height: 700 } })).newPage();
await mockApi(page, role);
for (const p of paths) {
  await page.goto(base + p);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  const bad = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed')
      .slice(0, 6)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 90)} right=${Math.round(e.getBoundingClientRect().right)} text=${(e.textContent ?? '').slice(0, 30)}`);
  });
  console.log(p, bad.length ? '\n  ' + bad.join('\n  ') : 'fits');
}
await browser.close();
