#!/usr/bin/env node
// Assembles src/ into the single, self-contained index.html that is deployed.
//   node scripts/build.mjs          write index.html
//   node scripts/build.mjs --check  fail if index.html is not up to date (CI)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const parts = readdirSync(join(src, 'js')).filter((f) => f.endsWith('.js')).sort();
const js = parts.map((f) => readFileSync(join(src, 'js', f), 'utf8')).join('');
const html = readFileSync(join(src, 'shell.html'), 'utf8') + '<script>\n' + js + '</script>\n</body>\n</html>\n';
const target = join(root, 'index.html');

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
  if (current !== html) {
    console.error('index.html is out of date. Run: npm run build');
    process.exit(1);
  }
  console.log('index.html is up to date');
} else {
  writeFileSync(target, html);
  console.log(`index.html written: ${parts.length} parts, ${(html.length / 1024).toFixed(0)} KB`);
}
