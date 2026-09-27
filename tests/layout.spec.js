import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

// Every menu element keeps its place and size whatever the language, mode, option or skin.
const SEL = ['#title', '#tagline', '#modeSeg', '#modeSeg button[data-mode=random]', '#modeSeg button[data-mode=daily]', '#modeInfo', '#tgKid',
  '#menuBest', '#btnTilt', '#btnTouch', '#skinsMenu', '#langSeg', '#menu .tgMusic', '#menu .tgSfx'];
const rects = (page) => page.evaluate((sel) => sel.map((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return s + ' ' + [r.x, r.y, r.width, r.height].map(Math.round).join(',');
}), SEL);

for (const vp of [{ width: 360, height: 640 }, { width: 800, height: 380 }]) {
  test.describe(`menu ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });
    test('the menu layout never moves', async ({ page }) => {
      await openGame(page);
      const base = await rects(page);
      const steps = [
        ['FR', '#langSeg button[data-lang=fr]'], ['daily', '#modeSeg button[data-mode=daily]'], ['kid on', '#tgKid'],
        ['EN', '#langSeg button[data-lang=en]'], ['random', '#modeSeg button[data-mode=random]'], ['kid off', '#tgKid'],
        ['continue', () => page.evaluate(() => { const g = window.__game; g.contS = CFG.START_S + 1120; g.refreshTexts(); })],
        ['FR again', '#langSeg button[data-lang=fr]'], ['sfx off', '#menu .tgSfx'], ['music off', '#menu .tgMusic'],
        ['skin', '#skinsMenu .skinRow:nth-child(2) .sw >> nth=3'],
      ];
      for (const [name, act] of steps) {
        if (typeof act === 'string') await page.click(act); else await act();
        expect(await rects(page), name).toEqual(base);
        // texts fit in their fixed boxes
        expect(await page.evaluate(() => ['modeInfo', 'tgKid'].map((id) => { const e = document.getElementById(id); return e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1; })), name).toEqual([true, true]);
      }
    });
  });
}

test('sound toggles are white icons without text', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => [...document.querySelectorAll('.tgMusic, .tgSfx')].map((b) => ({
    text: b.textContent.trim(), svg: !!b.querySelector('svg'), color: getComputedStyle(b).color, label: b.getAttribute('aria-label'),
  })));
  for (const b of r) { expect(b.text).toBe(''); expect(b.svg).toBe(true); expect(b.color).toBe('rgb(255, 255, 255)'); expect(b.label).toBeTruthy(); }
  await page.click('#menu .tgSfx');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#menu .tgSfx .mute')).display)).not.toBe('none');
});
