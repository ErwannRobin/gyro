import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test('boots to the menu without errors', async ({ page }) => {
  const errors = await openGame(page);
  await expect(page.locator('#title')).toHaveText('GYROLL');
  await expect(page.locator('#btnTilt')).toBeVisible();
  const st = await page.evaluate(() => ({ state: window.__game.state, chunks: window.__game.chunks.size }));
  expect(st.state).toBe('menu');
  expect(st.chunks).toBeGreaterThan(3);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('full run with the keyboard: play, pause, resume, fall, game over, retry, menu', async ({ page }) => {
  const errors = await openGame(page);
  await page.click('#btnTilt');                                     // desktop: keyboard control
  const tick = (n, draw = false) => page.evaluate(([n, draw]) => { const g = window.__game; g.halt = true; for (let k = 0; k < n; k++) g.tick(1 / 30, draw); return g.state; }, [n, draw]);
  expect(await tick(40)).toBe('play');

  const speed = await page.evaluate(() => {
    const g = window.__game; g.input.keys.add('arrowup');
    for (let k = 0; k < 90; k++) g.tick(1 / 30, false);
    g.input.keys.clear(); return g.ball.speed;
  });
  expect(speed).toBeGreaterThan(5);
  expect(await page.evaluate(() => window.__game.dist)).toBeGreaterThan(10);

  await page.evaluate(() => window.__game.pause());
  await expect(page.locator('#pause')).toBeVisible();
  await page.click('#btnResume');
  expect(await tick(40)).toBe('play');

  // move the ball past the edge of the track (no rail can catch it there)
  await page.evaluate(() => {
    const g = window.__game, b = g.ball, L = g.track.locate(b.p[0], b.p[2], b.hint);
    b.p[0] += L.rx * (L.w / 2 + 1.5); b.p[2] += L.rz * (L.w / 2 + 1.5);
  });
  expect(await tick(150)).toBe('over');
  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#ovDist')).toContainText('m');

  await page.click('#btnRetry');
  expect(await tick(40)).toBe('play');
  expect(await page.evaluate(() => window.__game.dist)).toBeLessThan(5);
  await page.evaluate(() => window.__game.pause());
  await page.click('#btnQuit');
  expect(await page.evaluate(() => window.__game.state)).toBe('menu');
  expect(errors).toEqual([]);
});

test('physics never produces NaN over a long run', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const g = window.__game; g.halt = true; g.startRun('keys');
    g.input.update = function () { const b = g.ball; this.x = Math.max(-1, Math.min(1, -b.u * 1.4)); this.y = 0.6; };
    let bad = 0;
    for (let k = 0; k < 1800; k++) {
      g.tick(1 / 60, false);
      if (![...g.ball.p, ...g.ball.v, g.score, g.dist].every(Number.isFinite)) bad++;
    }
    return { bad, state: g.state };
  });
  expect(r.bad).toBe(0);
});
