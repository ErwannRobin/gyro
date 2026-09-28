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

// Landscape: two columns. Left: title, tagline, mode switch (ABOUT, and INSTALL below it, in options).
// Right: PLAY, BEST and OPTIONS on one axis. The options panel slides over exactly that right column:
// nothing is cut, covered or off screen, in English and French, from a 568×320 screen (or a phone
// with the browser bars showing) to a 1024×600 one.
for (const [w, h, lang] of [[568, 320, 'fr'], [667, 375, 'en'], [844, 340, 'fr'], [844, 390, 'en'], [932, 430, 'fr'], [1024, 600, 'en']]) {
  test.describe(`landscape menu ${w}x${h} ${lang}`, () => {
    test.use({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    test('two aligned columns; the options panel covers nothing and fits', async ({ page }) => {
      await page.addInitScript((lang) => localStorage.setItem('gyroll.lang', JSON.stringify(lang)), lang);
      const errors = await openGame(page);
      await still(page);
      await page.evaluate(() => document.getElementById('btnInstall').classList.remove('hidden'));
      const box = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: (r.left + r.right) / 2 }; }, sel);
      const inView = (b, name) => { expect(b.l, name).toBeGreaterThanOrEqual(0); expect(b.r, name).toBeLessThanOrEqual(w); expect(b.t, name).toBeGreaterThanOrEqual(0); expect(b.b, name).toBeLessThanOrEqual(h); };
      const cut = () => page.evaluate(() => [...document.querySelectorAll('#menu .seg button, #menu .tg, #btnPlay, #btnOpts, #modeInfo')]
        .filter((e) => e.offsetParent && getComputedStyle(e).visibility === 'visible' && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map((e) => e.id || e.textContent));
      // light menu
      const L = {};
      for (const s of ['#title', '#tagline', '#modeSeg', '#modeInfo', '#btnPlay', '#menuBest', '#btnOpts']) { L[s] = await box(s); inView(L[s], s); }
      expect(L['#btnPlay'].l).toBeGreaterThan(Math.max(L['#title'].r, L['#modeSeg'].r, L['#modeInfo'].r));
      for (const s of ['#menuBest', '#btnOpts']) expect(Math.abs(L[s].cx - L['#btnPlay'].cx), s).toBeLessThan(2);
      for (const s of ['#tagline', '#modeSeg', '#modeInfo']) expect(Math.abs(L[s].cx - L['#title'].cx), s).toBeLessThan(5);   // the title's box ends with the letter spacing
      expect(L['#btnOpts'].t).toBeGreaterThan(L['#menuBest'].b);
      expect(await cut()).toEqual([]);
      // options
      await page.click('#btnOpts');
      await page.evaluate(() => window.__game.ui.pills());
      const O = {};
      for (const s of ['#title', '#tagline', '#btnAbout', '#btnInstall', '#langSeg', '#menu .tgSfx', '#btnOpts', '#sheet', '#tgKid', '#ctrlSeg', '#todSeg', '#skinsMenu']) { O[s] = await box(s); inView(O[s], s); }
      for (const s of ['#title', '#tagline', '#btnAbout', '#btnInstall']) expect(O[s].r, s + ' is left of the panel').toBeLessThanOrEqual(O['#sheet'].l);
      expect(Math.abs(O['#btnOpts'].cx - w / 2)).toBeLessThan(2); expect(O['#btnOpts'].b).toBeLessThanOrEqual(O['#sheet'].t);   // DONE: middle of the top bar
      expect(O['#btnInstall'].t).toBeGreaterThan(O['#btnAbout'].b); expect(Math.abs(O['#btnInstall'].cx - O['#btnAbout'].cx)).toBeLessThan(1);
      // one grid: every control starts and ends on the same lines, and the panel shows whole
      const sw = await page.evaluate(() => [...document.querySelectorAll('#skinsMenu .skinRow')].map((r) => { const s = r.querySelectorAll('.sw'); return [s[0].getBoundingClientRect().left, s[s.length - 1].getBoundingClientRect().right]; }));
      for (const [l, r] of sw) { expect(Math.abs(l - O['#ctrlSeg'].l)).toBeLessThan(2); expect(Math.abs(r - O['#ctrlSeg'].r)).toBeLessThan(2); }
      expect(Math.abs(O['#todSeg'].l - O['#ctrlSeg'].l)).toBeLessThan(1); expect(Math.abs(O['#todSeg'].r - O['#ctrlSeg'].r)).toBeLessThan(1);
      expect(Math.abs(O['#tgKid'].r - O['#ctrlSeg'].r)).toBeLessThan(1);
      expect(await page.evaluate(() => { const e = document.getElementById('sheet'); return e.scrollHeight <= e.clientHeight + 1; })).toBe(true);
      expect(await cut()).toEqual([]);
      expect(errors).toEqual([]);
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
