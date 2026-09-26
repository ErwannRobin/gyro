import js from '@eslint/js';
import globals from 'globals';
import { readFileSync, readdirSync } from 'node:fs';

// src/js/*.js are concatenated into one classic <script>, so their top-level names are shared.
// Collect them as globals so `no-undef` still catches typos across files.
const shared = {};
for (const f of readdirSync('src/js')) {
  const code = readFileSync(`src/js/${f}`, 'utf8');
  for (const m of code.matchAll(/^(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/gm)) shared[m[1]] = 'writable';
}

export default [
  { ignores: ['index.html', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['src/js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...shared } },
    rules: {
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: globals.serviceworker } },
  { files: ['scripts/**/*.mjs', '*.config.js'], languageOptions: { sourceType: 'module', globals: globals.node } },
  {
    files: ['tests/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser, ...shared } },
    rules: { 'no-redeclare': ['error', { builtinGlobals: false }] },
  },
];
