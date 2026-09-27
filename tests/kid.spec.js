import { test, expect } from '@playwright/test';
import { openGame, openOptions, play } from './helpers.js';

test('kid mode: side rails catch the ball, separate best, badge at game over', async ({ page }) => {
  const errors = await openGame(page);
  await openOptions(page);
  await page.click('#tgKid');
  expect(await page.evaluate(() => [window.__game.kid, window.__game.physics.kid])).toEqual([true, true]);
  await play(page);
  const r = await page.evaluate(() => {
    const g = window.__game; g.halt = true;
    for (let k = 0; k < 40; k++) g.tick(1 / 30, false);
    // steer hard to one side for 3 s: with rails the ball must stay on the track
    g.input.update = function () { this.x = 1; this.y = 0.2; };
    let minMargin = 9;
    for (let k = 0; k < 180 && g.state === 'play'; k++) {
      g.tick(1 / 60, false);
      const L = g.track.locate(g.ball.p[0], g.ball.p[2], g.ball.hint);
      minMargin = Math.min(minMargin, L.w / 2 - Math.abs(L.u));
    }
    return { state: g.state, lost: g.ball.lost, minMargin };
  });
  expect(r.lost).toBe(false);
  expect(r.minMargin).toBeGreaterThan(0.2);
  // end the run through a hole-free fall: teleport the ball past the rails
  await page.evaluate(() => {
    const g = window.__game, b = g.ball, L = g.track.locate(b.p[0], b.p[2], b.hint);
    b.p[0] += L.rx * (L.w / 2 + 1.5); b.p[2] += L.rz * (L.w / 2 + 1.5);
    for (let k = 0; k < 150 && g.state !== 'over'; k++) g.tick(1 / 30, false);
  });
  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#ovRails')).toBeVisible();
  const stored = await page.evaluate(() => [localStorage.getItem('gyroll.bestDist_kid'), localStorage.getItem('gyroll.bestDist')]);
  expect(Number(stored[0])).toBeGreaterThan(0);
  expect(stored[1]).toBeNull();
  expect(errors).toEqual([]);
});

test('normal mode has no rails badge', async ({ page }) => {
  await openGame(page);
  expect(await page.evaluate(() => window.__game.kid)).toBe(false);
  await play(page);
  await page.evaluate(() => {
    const g = window.__game; g.halt = true;
    for (let k = 0; k < 40; k++) g.tick(1 / 30, false);
    const b = g.ball, L = g.track.locate(b.p[0], b.p[2], b.hint);
    b.p[0] += L.rx * (L.w / 2 + 1.5); b.p[2] += L.rz * (L.w / 2 + 1.5);
    for (let k = 0; k < 150 && g.state !== 'over'; k++) g.tick(1 / 30, false);
  });
  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#ovRails')).toBeHidden();
});
