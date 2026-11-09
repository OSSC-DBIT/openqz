// Copy Mermaid (diagram renderer) next to the user guides, so /guides/*.html can draw their flow
// diagrams without a CDN (the CSP allows only same-origin scripts). The copy is git-ignored.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve('mermaid/package.json')), 'dist', 'mermaid.min.js');
const outDir = join(here, '..', 'public', 'guides', 'vendor');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, 'mermaid.min.js'));
console.log('guides: mermaid.min.js -> public/guides/vendor/');
