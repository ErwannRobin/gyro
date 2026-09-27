import { test, expect } from '@playwright/test';
import { openGame, openOptions } from './helpers.js';

// Every menu element keeps its place and size whatever the language, mode, option or skin, in the
// light menu and in options mode.
const LIGHT = ['#title', '#tagline', '#modeSeg', '#modeSeg button[data-mode=random]', '#modeSeg button[data-mode=daily]', '#modeInfo', '#btnPlay', '#menuBest', '#btnOpts'];
const OPTS = ['#title', '#btnAbout', '#tgKid', '#ctrlSeg', '#todSeg', '#skinsMenu', '#langSeg', '#menu .tgMusic', '#menu .tgSfx', '#btnOpts'];
const rects = (page, sel) => page.evaluate((sel) => sel.map((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return s + ' ' + [r.x, r.y, r.width, r.height].map(Math.round).join(',');
}), sel);
const still = (page) => page.addStyleTag({ content: '#menu *, #menu::before { transition: none !important; animation: none !important }' });

for (const vp of [{ width: 360, height: 640 }, { width: 800, height: 380 }]) {
  test.describe(`menu ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });
    test('the menu layout never moves', async ({ page }) => {
      await openGame(page);
      await still(page);
      // texts fit in their boxes
      const fit = (name) => page.evaluate(() => [...document.querySelectorAll('#modeInfo, #btnNewTrack, #tgKid, #btnAbout, .seg button')]
        .filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.id || e.textContent)).then((r) => expect(r, name).toEqual([]));
      const light = await rects(page, LIGHT);
      const run = async (list, steps, base) => {
        for (const [name, act] of steps) {
          if (typeof act === 'string') await page.click(act); else await act();
          expect(await rects(page, list), name).toEqual(base);
          await fit(name);
        }
      };
      const cont = () => page.evaluate(() => { const g = window.__game; g.contS = CFG.START_S + 1120; g.refreshTexts(); });
      await run(LIGHT, [['daily', '#modeSeg button[data-mode=daily]'], ['random', '#modeSeg button[data-mode=random]'], ['continue', cont]], light);
      await openOptions(page);
      const base = await rects(page, OPTS);
      await run(OPTS, [
        ['FR', '#langSeg button[data-lang=fr]'], ['kid on', '#tgKid'], ['EN', '#langSeg button[data-lang=en]'], ['kid off', '#tgKid'],
        ['FR again', '#langSeg button[data-lang=fr]'], ['sfx off', '#menu .tgSfx'], ['music off', '#menu .tgMusic'],
        ['touch', '#ctrlSeg button[data-ctrl=touch]'], ['night', '#todSeg button[data-tod=night]'],
        ['skin', '#skinsMenu .skinRow:nth-child(2) .sw >> nth=3'],
      ], base);
      await page.click('#btnOpts');                                 // back to the light menu, now in French, with the reset link
      expect(await rects(page, LIGHT)).toEqual(light);
      await fit('FR light');
      await run(LIGHT, [['daily FR', '#modeSeg button[data-mode=daily]'], ['random FR', '#modeSeg button[data-mode=random]']], light);
    });
  });
}

test('sound toggles are white icons without text', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => [...document.querySelectorAll('.tgMusic, .tgSfx')].map((b) => ({
    text: b.textContent.trim(), svg: !!b.querySelector('svg'), color: getComputedStyle(b).color, label: b.getAttribute('aria-label'),
  })));
  for (const b of r) { expect(b.text).toBe(''); expect(b.svg).toBe(true); expect(b.color).toBe('rgb(255, 255, 255)'); expect(b.label).toBeTruthy(); }
  await openOptions(page);
  await page.click('#menu .tgSfx');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#menu .tgSfx .mute')).display)).not.toBe('none');
});

test('segmented controls slide a pill under the chosen option', async ({ page }) => {
  await openGame(page);
  await still(page);
  const pill = (id) => page.evaluate((id) => {
    const s = document.getElementById(id), p = s.querySelector('.pill').getBoundingClientRect(), b = s.querySelector('button.on').getBoundingClientRect();
    return [Math.round(p.x - b.x) || 0, Math.round(p.width - b.width) || 0];
  }, id);
  for (const [id, sel] of [['modeSeg', '[data-mode=daily]'], ['options'], ['todSeg', '[data-tod=night]'], ['todSeg', '[data-tod=system]'], ['langSeg', '[data-lang=fr]']]) {
    if (id === 'options') { await openOptions(page); continue; }
    await page.click(`#${id} button${sel}`);
    expect(await pill(id), id + sel).toEqual([0, 0]);
  }
});

// Landscape pause: one column (no skin pickers) that fits on a short screen.
test('the landscape pause screen keeps only resume, sound and menu, and fits', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await openGame(page);
  await page.evaluate(() => { const g = window.__game; g.halt = true; g.startRun('tilt'); for (let i = 0; i < 60; i++) g.tick(1 / 30, false); g.pause(); });
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#pause .skins')).toHaveCount(0);
  const r = await page.evaluate(() => [...document.querySelectorAll('#pause > *')].filter((e) => e.offsetParent).map((e) => { const b = e.getBoundingClientRect(); return [e.id || e.className, b.top, b.bottom, b.left, b.right]; }));
  expect(r.map((e) => e[0])).toEqual(['', 'btnResume', 'btnRecal', 'volRow', 'volRow', 'btnQuit']);
  for (const [id, top, bottom, left, right] of r) { expect(top, id).toBeGreaterThanOrEqual(0); expect(bottom, id).toBeLessThanOrEqual(375); expect(left, id).toBeGreaterThanOrEqual(0); expect(right, id).toBeLessThanOrEqual(667); }
  for (let k = 1; k < r.length; k++) expect(r[k][1], r[k][0]).toBeGreaterThanOrEqual(r[k - 1][2] - 1);   // one column, no overlap
});

// Game over with every extra line (kid badge, new record): nothing is squeezed away. In landscape the
// result sits on the left and the buttons on the right; in portrait they follow each other.
for (const [vp, lang] of [[{ width: 667, height: 375 }, 'fr'], [{ width: 932, height: 430 }, 'en'], [{ width: 375, height: 667 }, 'fr'], [{ width: 390, height: 780 }, 'en']]) {
  test(`game over ${vp.width}x${vp.height} ${lang}: play again, share and menu all show and fit`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.addInitScript((lang) => localStorage.setItem('gyroll.lang', JSON.stringify(lang)), lang);
    await openGame(page);
    await page.addStyleTag({ content: '#over *, #over *::before { animation: none !important; transition: none !important }' });
    await page.evaluate(() => {
      const g = window.__game; g.halt = true; g.kid = true;
      g.startRun('keys'); for (let k = 0; k < 40; k++) g.tick(1 / 30, false);
      g.best = 0; g.dist = 1284; g.finishRun();
    });
    await expect(page.locator('#over')).toBeVisible();
    await expect(page.locator('#record')).toBeVisible();
    await expect(page.locator('#ovRails')).toBeVisible();
    const box = (sel) => page.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height }; }, sel);
    for (const sel of ['#over h2', '#ovDist', '#ovBest', '#btnRetry', '#btnShare', '#btnMenu']) {
      const b = await box(sel);
      expect(b.top, sel).toBeGreaterThanOrEqual(0); expect(b.bottom, sel).toBeLessThanOrEqual(vp.height);
      expect(b.left, sel).toBeGreaterThanOrEqual(0); expect(b.right, sel).toBeLessThanOrEqual(vp.width);
    }
    const retry = await box('#btnRetry'), share = await box('#btnShare'), menu = await box('#btnMenu'), best = await box('#ovBest'), rec = await box('#record .txt'), rails = await box('#ovRails');
    expect(rec.left).toBeGreaterThanOrEqual(0); expect(rails.left).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.getElementById('ovRails').textContent)).toContain(lang === 'fr' ? 'Réalisé' : 'Achieved');
    expect(retry.h).toBeGreaterThanOrEqual(48);
    expect(share.h).toBeGreaterThanOrEqual(42);
    expect(share.top).toBeGreaterThanOrEqual(retry.bottom - 1);
    expect(menu.top).toBeGreaterThanOrEqual(share.bottom - 1);
    if (vp.width > vp.height) for (const r of [best, rec, rails]) expect(retry.left).toBeGreaterThanOrEqual(r.right);
    else expect(retry.top).toBeGreaterThanOrEqual(best.bottom);
    await page.click('#btnRetry');
    expect(await page.evaluate(() => window.__game.state)).not.toBe('over');
  });
}
