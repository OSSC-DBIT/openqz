// App icons and install screenshots for the PWA, drawn from the OpenQZ logo (the pink tile with
// the white magnifier, the same as public/favicon.svg).
//   node scripts/make-icons.mjs            icons only
//   node scripts/make-icons.mjs --shots    also the install-dialog screenshots (dev stack running on :8088)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PINK = '#d6177f';
const glyph = '<circle cx="30" cy="30" r="14" fill="none" stroke="#fff" stroke-width="6"/><path d="M41 41l8 8" stroke="#fff" stroke-width="6" stroke-linecap="round"/>';

/** rounded: tile with corners (transparent outside); full: edge to edge (maskable, Apple). scale: glyph size. */
const svg = ({ rounded, scale }) => {
  const g = `<g transform="translate(32 32) scale(${scale}) translate(-31 -31)">${glyph}</g>`;
  const bg = rounded ? `<rect width="64" height="64" rx="16" fill="${PINK}"/>` : `<rect width="64" height="64" fill="${PINK}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bg}${g}</svg>`;
};

const ICONS = [
  ['icon-192.png', 192, { rounded: true, scale: 1 }],
  ['icon-512.png', 512, { rounded: true, scale: 1 }],
  // Maskable: the launcher cuts its own shape; the logo stays inside the middle 80 % circle.
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.72 }],
  ['icon-maskable-192.png', 192, { rounded: false, scale: 0.72 }],
  // iOS rounds the corners itself and shows transparency as black.
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.85 }],
];

const browser = await chromium.launch();
for (const [file, size, opt] of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(opt).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(pub, file), omitBackground: true });
  await page.close();
  console.log('wrote', file);
}

if (process.argv.includes('--shots')) {
  const base = process.env.BASE_URL ?? 'http://localhost:8088';
  fs.mkdirSync(path.join(pub, 'screenshots'), { recursive: true });
  const shots = [
    ['wide.png', { width: 1280, height: 720 }, '/'],
    ['narrow.png', { width: 412, height: 915 }, '/login'],
  ];
  for (const [file, viewport, url] of shots) {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(base + url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(pub, 'screenshots', file) });
    await ctx.close();
    console.log('wrote screenshots/' + file);
  }
}
await browser.close();
