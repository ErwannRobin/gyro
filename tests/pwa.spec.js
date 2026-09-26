import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test('installable app: manifest, icons, service worker and offline play', async ({ page, context }) => {
  await openGame(page);
  const r = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const manifest = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
    return { scope: reg.scope, name: manifest.short_name, icons: manifest.icons.map((i) => i.src), display: manifest.display };
  });
  expect(r.name).toBe('GYROLL');
  expect(r.display).toBe('fullscreen');
  for (const src of [...r.icons, 'icons/apple-touch-icon.png', 'og.jpg']) expect((await page.request.get('/' + src)).status()).toBe(200);
  await page.waitForFunction(async () => (await caches.keys()).length > 0 && !!(await caches.match('./index.html')));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu');
  await context.setOffline(false);
});
