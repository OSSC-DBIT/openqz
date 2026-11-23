// Draw the ```mermaid flow diagrams of the user guides (docs/guides/*.md) once, as SVG files, so
// the guide pages need no diagram script and no inline styles (the CSP has no 'unsafe-inline').
//
//   pnpm guides:diagrams          (after changing a diagram; then pnpm guides)
//
// Each diagram is drawn in a light and a dark version (public/guides/diagrams/<hash>-light.svg,
// -dark.svg). The file name is a hash of the diagram's source, so pnpm guides (which CI runs) can
// point at it without drawing anything, and a changed diagram gets a new file. The SVGs carry the
// DM Sans font and use plain SVG text (no HTML labels), so they look the same on every device.
// Shown with <img>, an SVG is a sealed picture: its own styles cannot touch the page.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = join(here, '..', '..', 'docs', 'guides');
const out = join(here, '..', 'public', 'guides', 'diagrams');
const force = process.argv.includes('--force');

/** Bump to redraw every diagram (style changes below). Must match build-guides.mjs. */
export const DIAGRAM_STYLE = '2';
export const diagramHash = (source) => createHash('sha256').update(`${DIAGRAM_STYLE}\n${source.trim()}`).digest('hex').slice(0, 12);

export function mermaidBlocks(md) {
  return [...md.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(out, { recursive: true });
  const sources = new Map();
  for (const f of readdirSync(src).filter((x) => x.endsWith('.md'))) for (const block of mermaidBlocks(readFileSync(join(src, f), 'utf8'))) sources.set(diagramHash(block), block);

  const font = readFileSync(require.resolve('@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2')).toString('base64');
  const fontFace = `@font-face{font-family:'DMS';font-weight:100 1000;src:url(data:font/woff2;base64,${font}) format('woff2')}`;
  const mermaidJs = readFileSync(join(dirname(require.resolve('mermaid/package.json')), 'dist', 'mermaid.min.js'), 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><style>${fontFace}</style></head><body></body></html>`);
  await page.addScriptTag({ content: mermaidJs });
  await page.evaluate(() => document.fonts.load("16px 'DMS'"));

  const keep = new Set();
  for (const [hash, source] of sources) {
    for (const theme of ['light', 'dark']) {
      const file = join(out, `${hash}-${theme}.svg`);
      keep.add(file);
      if (existsSync(file) && !force) continue;
      const svg = await page.evaluate(
        async ({ source, theme, id }) => {
          const m = window.mermaid;
          m.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: theme === 'dark' ? 'dark' : 'default',
            fontFamily: 'DMS',
            htmlLabels: false,
            themeVariables: { fontFamily: 'DMS', fontSize: '15px' },
            flowchart: { htmlLabels: false, curve: 'basis' },
          });
          return (await m.render(id, source)).svg;
        },
        { source, theme, id: `d${hash}${theme}` },
      );
      // A standalone file: the font inside, a real size (from the viewBox), no page-dependent width.
      const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
      const w = vb ? Math.ceil(Number(vb[3])) : 800;
      const h = vb ? Math.ceil(Number(vb[4])) : 400;
      const bg = theme === 'dark' ? '#1c1a27' : '#ffffff';
      const fixed = svg
        .replace(/<br\s*>/g, '<br/>') // XML, not HTML: one bad tag and the picture is refused
        .replace(/<svg([^>]*?) width="100%"/, `<svg$1 width="${w}" height="${h}"`)
        .replace(/ style="max-width: [\d.]+px;?"/, '')
        .replace(/(<svg[^>]*>)/, `$1<style>${fontFace} svg{background:${bg}}</style>`);
      writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n${fixed}\n`);
      console.log(`diagram ${hash}-${theme}.svg (${w}x${h})`);
    }
  }
  await browser.close();
  // drawings of diagrams that no longer exist
  for (const f of readdirSync(out)) if (f.endsWith('.svg') && !keep.has(join(out, f))) rmSync(join(out, f));
  console.log(`${sources.size} diagrams in public/guides/diagrams/`);
}
