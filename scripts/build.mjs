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
let html = readFileSync(join(src, 'shell.html'), 'utf8') + '<script>\n' + js + '</script>\n</body>\n</html>\n';
// The About screen shows the file's own line count and size: write them in, again until the size
// (which includes its own digits) stays the same.
const INFO = /const BUILD_INFO = \{ lines: \d+, kb: \d+ \};/;
if (!INFO.test(html)) throw new Error('BUILD_INFO not found in src/js');
for (let k = 0, kb = -1; k < 5; k++) {
  const lines = html.split('\n').length - 1, size = Math.round(Buffer.byteLength(html) / 1024);
  if (size === kb) break;
  kb = size; html = html.replace(INFO, `const BUILD_INFO = { lines: ${lines}, kb: ${kb} };`);
}
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
  console.log(`index.html written: ${parts.length} parts, ${html.split('\n').length - 1} lines, ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
}
