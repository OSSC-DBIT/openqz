// Contact sheets for reviewing frames: node tools/sheet.mjs <dir> <outPrefix> [filter] [step] [perSheet] [cols]
// Files in <dir> whose names contain [filter] are laid out in order, every [step]th one, with its
// frame number (or file name) on each tile.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [dir, outPrefix, filter = '', step = '1', perSheet = '48', cols = '8'] = process.argv.slice(2);
const files = fs
  .readdirSync(dir)
  .filter((f) => /\.(jpe?g|png)$/i.test(f) && f.includes(filter))
  .sort()
  .filter((_, i) => i % Number(step) === 0);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1900, height: 900 } })).newPage();
for (let n = 0; n * Number(perSheet) < files.length; n++) {
  const part = files.slice(n * Number(perSheet), (n + 1) * Number(perSheet));
  const tiles = part
    .map((f) => {
      const mime = f.endsWith('png') ? 'png' : 'jpeg';
      const label = f.match(/(\d+)\.\w+$/)?.[1] ?? f;
      return `<div><img src="data:image/${mime};base64,${fs.readFileSync(`${dir}/${f}`).toString('base64')}"><span>${label}</span></div>`;
    })
    .join('');
  await page.setContent(`<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:3px;padding:3px;align-content:start}img{width:100%;display:block}div{position:relative}span{position:absolute;left:2px;top:2px;background:#000c;color:#fff;font:11px sans-serif;padding:1px 4px}</style>${tiles}`);
  await page.screenshot({ path: `${outPrefix}${n}.png`, fullPage: true });
}
await browser.close();
console.log(Math.ceil(files.length / Number(perSheet)), 'sheet(s)');
