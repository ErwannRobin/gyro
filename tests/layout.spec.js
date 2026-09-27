import { test, expect } from '@playwright/test';
import { openGame, openOptions } from './helpers.js';

// Every menu element keeps its place and size whatever the language, mode, option or skin, in the
// light menu and in options mode.
const LIGHT = ['#title', '#tagline', '#modeSeg', '#modeSeg button[data-mode=random]', '#modeSeg button[data-mode=daily]', '#modeInfo', '#btnPlay', '#menuBest', '#btnOpts'];
const OPTS = ['#title', '#modeSeg', '#modeInfo', '#tgKid', '#ctrlSeg', '#todSeg', '#skinsMenu', '#langSeg', '#menu .tgMusic', '#menu .tgSfx', '#btnOpts'];
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
      const light = await rects(page, LIGHT);
      await openOptions(page);
      const base = await rects(page, OPTS);
      const steps = [
        ['FR', '#langSeg button[data-lang=fr]'], ['daily', '#modeSeg button[data-mode=daily]'], ['kid on', '#tgKid'],
        ['EN', '#langSeg button[data-lang=en]'], ['random', '#modeSeg button[data-mode=random]'], ['kid off', '#tgKid'],
        ['continue', () => page.evaluate(() => { const g = window.__game; g.contS = CFG.START_S + 1120; g.refreshTexts(); })],
        ['FR again', '#langSeg button[data-lang=fr]'], ['sfx off', '#menu .tgSfx'], ['music off', '#menu .tgMusic'],
        ['touch', '#ctrlSeg button[data-ctrl=touch]'], ['night', '#todSeg button[data-tod=night]'],
        ['skin', '#skinsMenu .skinRow:nth-child(2) .sw >> nth=3'],
      ];
      for (const [name, act] of steps) {
        if (typeof act === 'string') await page.click(act); else await act();
        expect(await rects(page, OPTS), name).toEqual(base);
        // texts fit in their boxes
        expect(await page.evaluate(() => [...document.querySelectorAll('#modeInfo, #tgKid, .seg button')]
          .filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.id || e.textContent)), name).toEqual([]);
      }
      await page.click('#btnOpts');                                 // back to the light menu, now in French
      expect(await rects(page, LIGHT)).toEqual(light);
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
  await openOptions(page);
  await still(page);
  const pill = (id) => page.evaluate((id) => {
    const s = document.getElementById(id), p = s.querySelector('.pill').getBoundingClientRect(), b = s.querySelector('button.on').getBoundingClientRect();
    return [Math.round(p.x - b.x) || 0, Math.round(p.width - b.width) || 0];
  }, id);
  for (const [id, sel] of [['modeSeg', '[data-mode=daily]'], ['todSeg', '[data-tod=night]'], ['todSeg', '[data-tod=system]'], ['langSeg', '[data-lang=fr]']]) {
    await page.click(`#${id} button${sel}`);
    expect(await pill(id), id + sel).toEqual([0, 0]);
  }
});
