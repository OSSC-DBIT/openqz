// Render the film. Copy into frontend/e2e (where Playwright is installed) and set FILM_DIR:
//   node ../video/film/render.mjs beats  <outDir> [offset]   one frame per beat (t = beat/2 + offset)
//   node ../video/film/render.mjs audio  <out.wav>
//   node ../video/film/render.mjs frames <outDir> <from> <to>  subframes 3 per frame at 60 fps
//   node ../video/film/render.mjs at     <outDir> <t...>        frames at given times
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The film's folder: next to this script, or FILM_DIR when the script runs from a copy (Playwright
// must be importable from where the script sits).
const here = process.env.FILM_DIR ?? path.dirname(fileURLToPath(import.meta.url));
const [mode, out, a, b, ...rest] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(pathToFileURL(path.join(here, process.env.FILM_FILE ?? 'film.html')).href);
await page.evaluate(() => window.ready);

async function shot(t, file, quality = 92) {
  await page.evaluate((tt) => window.seek(tt), t);
  await page.screenshot({ path: file, type: 'jpeg', quality });
}

if (mode === 'audio') {
  const b64 = await page.evaluate(() => window.renderAudio());
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out);
} else {
  fs.mkdirSync(out, { recursive: true });
  if (mode === 'beats') {
    const off = Number(a ?? 0.4);
    const beats = Math.round((await page.evaluate(() => window.FILM_LENGTH ?? 15)) / 0.5);
    for (let beat = 0; beat < beats; beat++) await shot(beat * 0.5 + off, path.join(out, `beat-${String(beat).padStart(3, '0')}.jpeg`), 80);
  } else if (mode === 'at') {
    for (const t of [a, b, ...rest].filter(Boolean).map(Number)) await shot(t, path.join(out, `t-${String(Math.round(t * 1000)).padStart(5, '0')}.jpeg`), 80);
  } else if (mode === 'frames') {
    const from = Number(a), to = Number(b);
    for (let f = from; f < to; f++) for (let k = 0; k < 3; k++) await shot((f + k / 3) / 60, path.join(out, `sub-${String(f * 3 + k).padStart(5, '0')}.jpeg`));
    console.log('frames', from, to);
  }
}
await browser.close();
