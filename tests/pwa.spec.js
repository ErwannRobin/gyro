import { test, expect } from '@playwright/test';
import { openGame, openOptions } from './helpers.js';

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

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const openInstall = async (page) => {
  await openOptions(page);
  await expect(page.locator('#btnInstall')).toBeVisible();             // next to ABOUT, no scrolling
  await page.click('#btnInstall');
  await page.waitForFunction(() => document.getElementById('install').classList.contains('open'));
};

test.describe('install guide on an iPhone', () => {
  test.use({ userAgent: IPHONE, viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  test('INSTALL opens a guide: a phone plays the Safari steps while the list follows', async ({ page }) => {
    const errors = await openGame(page);
    await openInstall(page);
    await expect(page.locator('#insSteps li b')).toHaveText(['Tap Share', 'Choose “Add to Home Screen”', 'Tap “Add”']);
    await expect(page.locator('#insFig')).toBeVisible();
    await expect(page.locator('#insRow')).toHaveText('Add to Home Screen');
    // the phone steps through: tap Share, the share sheet, "Add", the icon on the home screen
    for (const [p, on] of [[0, 0], [1, 1], [2, 2], [3, 2]]) {
      await page.waitForFunction((p) => document.getElementById('insPhone').className === 'ios p' + p, p, { timeout: 5000 });
      expect(await page.evaluate(() => [...document.querySelectorAll('#insSteps li')].map((l) => l.classList.contains('on')))).toEqual([0, 1, 2].map((i) => i === on));
    }
    // every step fits on the screen, and Escape closes the guide
    const fit = await page.evaluate(() => [...document.querySelectorAll('#insSteps li')].every((l) => l.scrollWidth <= l.clientWidth + 1));
    expect(fit).toBe(true);
    // a finger scrolls the guide down to its last button (the page blocks touch scrolling everywhere else)
    const sc = await page.evaluate(() => {
      const move = (el) => { const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 400 }); return el.dispatchEvent(new TouchEvent('touchmove', { cancelable: true, bubbles: true, touches: [t], targetTouches: [t], changedTouches: [t] })); };
      const box = document.getElementById('insScroll'), guide = move(document.getElementById('insSteps')), menu = move(document.getElementById('menu'));
      box.scrollTop = box.scrollHeight;
      return { guide, menu, scrolls: box.scrollHeight > box.clientHeight, end: document.getElementById('btnCopyLink').getBoundingClientRect().bottom <= innerHeight };
    });
    expect(sc).toEqual({ guide: true, menu: false, scrolls: true, end: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('#install')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('install on Android', () => {
  test.use({ userAgent: PIXEL, viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  test('the browser prompt is used when it is offered; the guide otherwise', async ({ page }) => {
    const errors = await openGame(page);
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(e);
    });
    await openOptions(page);
    await page.click('#btnInstall');
    expect(await page.evaluate(() => window.__prompted)).toBe(true);
    await expect(page.locator('#install')).toBeHidden();
    // a dismissed prompt cannot be shown again: the next tap opens the Android guide
    await page.click('#btnInstall');
    await page.waitForFunction(() => document.getElementById('install').classList.contains('open'));
    await expect(page.locator('#insSteps li b').first()).toHaveText('Open the browser menu ⋮');
    expect(await page.evaluate(() => document.getElementById('insPhone').classList.contains('android'))).toBe(true);
    await page.click('#btnInstallClose');
    await expect(page.locator('#install')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('install on Firefox', () => {
  test.use({ userAgent: FIREFOX });
  test('Firefox cannot install web apps: the guide says where to go, in French too', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('gyroll.lang', '"fr"'));
    const errors = await openGame(page);
    await openInstall(page);
    await expect(page.locator('#insFig')).toBeHidden();
    await expect(page.locator('#insSteps li b')).toHaveText(['Firefox ne sait pas installer d’appli web', 'Puis suivez le guide ici']);
    await expect(page.locator('#insHelp')).toContainText('127.0.0.1:4173');
    await expect(page.locator('#btnCopyLink')).toHaveText('COPIER LE LIEN');
    expect(errors).toEqual([]);
  });
});
