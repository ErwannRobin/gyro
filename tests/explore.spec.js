import { test, expect } from '@playwright/test';
import { openGame, teleport } from './helpers.js';

// Starts a keyboard run, moves to `dist` meters and pushes the ball off the side until game over.
async function fallAt(page, dist) {
  await page.evaluate(() => {
    const g = window.__game; g.halt = true;
    if (g.state !== 'menu') g.goMenu();
    g.startRun('keys'); for (let k = 0; k < 40; k++) g.tick(1 / 30, false);
  });
  await page.evaluate(teleport, dist);
  await page.evaluate(() => {
    const g = window.__game, b = g.ball, L = g.track.locate(b.p[0], b.p[2], b.hint);
    b.p[0] += L.rx * (L.w / 2 + 1.5); b.p[2] += L.rz * (L.w / 2 + 1.5);
    for (let k = 0; k < 150 && g.state !== 'over'; k++) g.tick(1 / 30, false);
  });
}

test('random mode: the next run and the menu start near the fall, until "new track"', async ({ page }) => {
  const errors = await openGame(page);
  const seed0 = await page.evaluate(() => window.__game.rSeed);
  await fallAt(page, 320);
  const r = await page.evaluate(() => { const g = window.__game; return { st: g.state, cont: g.contS - CFG.START_S, saved: +localStorage.getItem('gyroll.rpos') - CFG.START_S }; });
  expect(r.st).toBe('over');
  expect(r.cont).toBeGreaterThan(250);
  expect(r.cont).toBeLessThan(320);
  expect(r.saved).toBe(r.cont);
  // retry starts there, with the distance counted from the new start
  await page.click('#btnRetry');
  const run = await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 40; k++) g.tick(1 / 30, false); return { s: g.startS - CFG.START_S, dist: g.dist, seed: g.rSeed, zone: g.zoneIdx }; });
  expect(Math.abs(run.s - r.cont)).toBeLessThan(1);
  expect(run.dist).toBeLessThan(5);
  expect(run.seed).toBe(seed0);
  // the menu shows the same spot, and remembers it after a reload
  await page.evaluate(() => window.__game.goMenu());
  expect(await page.evaluate(() => window.__game.ball.s - CFG.START_S)).toBeCloseTo(r.cont, 0);
  await expect(page.locator('#modeTxt')).toContainText(String(Math.floor(r.cont)));
  await expect(page.locator('#btnNewTrack')).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.R);
  expect(await page.evaluate(() => [window.__game.rSeed, Math.round(window.__game.ball.s - CFG.START_S)])).toEqual([seed0, Math.round(r.cont)]);
  // "new track": back to the start of a different track
  await page.click('#btnNewTrack');
  const n = await page.evaluate(() => { const g = window.__game; return { s: g.ball.s - CFG.START_S, seed: g.rSeed }; });
  expect(n.s).toBeLessThan(1);
  expect(n.seed).not.toBe(seed0);
  await expect(page.locator('#btnNewTrack')).toBeHidden();
  expect(errors).toEqual([]);
});

test('worlds follow the position on the track when a run starts far away', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => { const g = window.__game; g.contS = CFG.START_S + 1120; g.newWorld(); g.halt = true; for (let k = 0; k < 10; k++) g.tick(1 / 30, false); });
  expect(await page.evaluate(() => [window.__game.zoneIdx, zoneAt(window.__game.ball.s)])).toEqual([2, 2]);
});

test('daily run always starts from the beginning', async ({ page }) => {
  await openGame(page, '/?mode=daily');
  await fallAt(page, 320);
  await page.evaluate(() => window.__game.goMenu());
  expect(await page.evaluate(() => window.__game.ball.s - CFG.START_S)).toBeLessThan(1);
});

test('the share video is only made when the button is pressed', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 12; k++) g.replay.capture(g.canvas, 1, k * 10, false); });
  await fallAt(page, 60);
  await expect(page.locator('#over')).toBeVisible();
  expect(await page.evaluate(() => [window.__game.shareSt, window.__game.replay.job])).toEqual(['idle', null]);
  await expect(page.locator('#btnShare')).toContainText('SHARE MY SCORE');
  await page.click('#btnShare');
  expect(await page.evaluate(() => window.__game.shareSt)).not.toBe('idle');
  await page.waitForFunction(() => ['ready', 'saved'].includes(window.__game.shareSt), null, { timeout: 60_000 });
  if (await page.evaluate(() => window.__game.shareSt === 'ready')) await expect(page.locator('#btnShare')).toContainText('SHARE THE VIDEO');
});

test('on the menu, turning and tilting the phone moves the camera around the ball', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const g = window.__game, I = g.input, C = g.cam; g.halt = true;
    const feed = (alpha, beta, n = 90) => { for (let k = 0; k < n; k++) { I.onOrient({ alpha, beta, gamma: 0 }); g.tick(1 / 60, false); } };
    feed(0, 40); const a0 = C.orbA, h0 = C.orbH;
    feed(60, 40); const a1 = C.orbA;
    feed(60, 15); const h1 = C.orbH;
    return { turn: wrapAngle(a1 - a0), h0, h1 };
  });
  expect(r.turn).toBeGreaterThan(0.8);                          // turned left by 60°: the camera went round by about as much
  expect(r.h1).toBeGreaterThan(r.h0 + 1.5);                     // phone tilted down: camera higher, looking down
});
