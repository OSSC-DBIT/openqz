// Grab the preview videos of reference templates and save one frame every few tenths of a
// second, for study. Usage: node tools/refs.mjs <outDir> <url> [url...]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [out, ...urls] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [n, url] of urls.entries()) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const media = new Set();
  page.on('response', (r) => {
    const u = r.url();
    const type = r.headers()['content-type'] || '';
    if (/video\/|mp4|webm/i.test(type) || /\.(mp4|webm)(\?|$)/i.test(u)) media.add(u);
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
  } catch (e) {
    console.log('load', url, e.message.slice(0, 80));
  }
  const found = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ src: v.currentSrc || v.src || v.querySelector('source')?.src, w: v.videoWidth, h: v.videoHeight, dur: v.duration })));
  console.log(`#${n}`, url);
  console.log('  <video>', JSON.stringify(found).slice(0, 400));
  console.log('  media', [...media].slice(0, 5).join('\n        '));
  // film the biggest playing video on the page through CDP (does not wait for web fonts)
  const cdp = await ctx.newCDPSession(page);
  const box = await page.evaluate(() => {
    const vs = [...document.querySelectorAll('video, canvas, iframe')].map((v) => ({ r: v.getBoundingClientRect() })).filter((x) => x.r.width > 300);
    vs.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    const r = vs[0]?.r;
    return r ? { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 1600), height: Math.min(r.height, 1000) } : null;
  });
  console.log('  box', JSON.stringify(box));
  for (let i = 0; i < 40; i++) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70, ...(box ? { clip: { ...box, scale: 0.5 } } : {}) });
    fs.writeFileSync(`${out}/r${n}-${String(i).padStart(2, '0')}.jpeg`, Buffer.from(shot.data, 'base64'));
    await page.waitForTimeout(250);
  }
  await ctx.close();
}
await browser.close();
