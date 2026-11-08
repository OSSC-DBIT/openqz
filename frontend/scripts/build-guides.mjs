// Build the user guides (docs/guides/*.md) into static pages served at /guides/*.html.
// Run: pnpm guides   (CI fails if the generated pages are out of date)
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'docs', 'guides');
const out = join(here, '..', 'public', 'guides');
mkdirSync(out, { recursive: true });

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} | OpenQZ</title>
<style>
  :root { --brand:#5b3fd6; --ink:#1d1b2c; --muted:#6b6880; --bg:#f6f5fb; --card:#fff; --line:#e6e4ef; }
  @media (prefers-color-scheme: dark) { :root { --ink:#ecebf5; --muted:#a29fb8; --bg:#12111a; --card:#1c1a27; --line:#2c2a3a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:760px; margin:0 auto; padding:24px 16px 64px; }
  header { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  header a { color:var(--brand); font-weight:700; text-decoration:none; }
  h1 { font-size:1.9rem; line-height:1.2; } h2 { margin-top:2rem; border-bottom:1px solid var(--line); padding-bottom:.3rem; }
  a { color:var(--brand); } code { background:var(--card); border:1px solid var(--line); border-radius:6px; padding:1px 5px; }
  table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; }
  th, td { border:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top; }
  th { background:var(--card); }
  blockquote { margin:1rem 0; padding:.6rem 1rem; border-left:4px solid var(--brand); background:var(--card); border-radius:8px; }
</style>
</head>
<body><main>
<header><a href="/login">&larr; OpenQZ</a></header>
${body}
</main></body>
</html>
`;

const files = readdirSync(src).filter((f) => f.endsWith('.md'));
for (const f of files) {
  const md = readFileSync(join(src, f), 'utf8');
  const title = (md.match(/^#\s+(.+)$/m) || [, basename(f, '.md')])[1];
  const html = marked.parse(md, { gfm: true });
  writeFileSync(join(out, basename(f, '.md') + '.html'), page(title, html));
  console.log(`guides: ${f} -> public/guides/${basename(f, '.md')}.html`);
}
