import { test, expect } from '@playwright/test';
import { openGame, teleport } from './helpers.js';

const box = (page, s) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: r.left + r.width / 2 }; }, s);
async function run(page) {
  await page.evaluate(() => { const g = window.__game; g.halt = true; g.startRun('keys'); g.ui.hideNow('menu'); for (let k = 0; k < 40; k++) g.tick(1 / 30, false); });
}

test('landscape: the star gauge sits bottom right, its bar on the line of the speed bar; no controls tag in the game', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const errors = await openGame(page);
  await run(page);
  expect(await page.locator('#ctrlTag').count()).toBe(0);
  const bar = await box(page, '#power .bar'), sb = await box(page, '#speedBar'), sp = await box(page, '#speedo');
  expect(Math.abs(bar.b - sb.b)).toBeLessThan(1.5);
  expect(Math.abs((844 - bar.r) - sp.l)).toBeLessThan(1.5);              // the same margin on both sides
  expect(bar.l).toBeGreaterThan(844 / 2);
  // portrait keeps it in the middle, above the speed
  await page.setViewportSize({ width: 390, height: 780 });
  const p = await box(page, '#power .bar'), sp2 = await box(page, '#speedo');
  expect(Math.abs(p.cx - 195)).toBeLessThan(1);
  expect(p.b).toBeLessThan(sp2.t);
  expect(errors).toEqual([]);
});

test('a ball too slow is warned well before the falling edge reaches it; a fast one is not', async ({ page }) => {
  const errors = await openGame(page);
  await run(page);
  // standing still: the edge closes in; the warning comes about 20 m before it, and stays until the fall
  const r = await page.evaluate(() => {
    const g = window.__game, out = {};
    for (let k = 0; k < 60 * 40 && g.state === 'play'; k++) {
      g.tick(1 / 60, false);
      if (g.fallOn && !out.on) out.on = { gap: g.fallGap, t: g.runT, cls: document.getElementById('fallWarn').classList.contains('on'), txt: document.getElementById('fallWarn').textContent };
      if (out.on && !g.fallOn && g.state === 'play') out.off = true;
    }
    out.fallT = g.runT; out.state = g.state; out.cls = document.getElementById('fallWarn').classList.contains('on');
    return out;
  });
  expect(r.on.cls).toBe(true);
  expect(r.on.txt).toMatch(/SPEED UP!The track is collapsing · \d+ m/);
  expect(r.on.gap).toBeGreaterThan(20); expect(r.on.gap).toBeLessThan(24.5);
  expect(r.off).toBeUndefined();
  expect(r.state).not.toBe('play');
  expect(r.fallT - r.on.t).toBeGreaterThan(4);                         // seconds of warning before the fall
  expect(r.cls).toBe(false);                                           // gone once the ball falls
  // rolling fast near the edge: no warning
  await run(page);
  await page.evaluate(teleport, 300);
  const fast = await page.evaluate(() => {
    const g = window.__game, b = g.ball;
    g.collapseS = b.s - 20; g.sRate = 22; g.prevS = b.s;
    const p = [0, 0, 0, 0]; g.track.pointAt(b.s, 0, 0, p); b.v[0] = Math.sin(p[3]) * 22; b.v[2] = Math.cos(p[3]) * 22;
    let on = false; for (let k = 0; k < 20; k++) { g.tick(1 / 60, false); on = on || g.fallOn; }
    return on;
  });
  expect(fast).toBe(false);
  expect(errors).toEqual([]);
});
