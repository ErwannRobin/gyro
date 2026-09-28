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

test('random mode: the next run and the menu restart at the last checkpoint, until "new track"', async ({ page }) => {
  const errors = await openGame(page);
  const seed0 = await page.evaluate(() => window.__game.rSeed);
  // a fall before the first checkpoint restarts at the very start
  await fallAt(page, 150);
  expect(await page.evaluate(() => window.__game.contS)).toBe(await page.evaluate(() => CFG.START_S));
  await fallAt(page, 420);
  const r = await page.evaluate(() => { const g = window.__game; return { st: g.state, cont: g.contS - CFG.START_S, saved: +localStorage.getItem('gyroll.rpos') - CFG.START_S }; });
  expect(r.st).toBe('over');
  expect(r.cont).toBeGreaterThan(250);
  expect(r.cont).toBeLessThan(420);
  expect(r.cont % 10).toBe(0);                                  // checkpoints sit on round distances
  expect(r.saved).toBe(r.cont);
  // retry starts there, with the distance counted from the new start
  await page.click('#btnRetry');
  const run = await page.evaluate(() => {
    const g = window.__game, gate = g.track.objects.find((o) => o.kind === 'gate' && Math.abs(o.s - g.contS) < 0.01);
    const toasts = () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|');
    document.getElementById('toasts').textContent = '';           // toasts left from the last run
    for (let k = 0; k < 40; k++) g.tick(1 / 30, false);
    return { s: g.startS - CFG.START_S, dist: g.dist, seed: g.rSeed, gate: !!gate && gate.passed, score: g.score, toasts: toasts() };
  });
  expect(Math.abs(run.s - r.cont)).toBeLessThan(1);
  expect(run.gate).toBe(true);                                  // the run starts under that checkpoint's gate…
  expect(run.toasts).not.toContain('CHECKPOINT');               // …which does not count again
  expect(run.dist).toBeLessThan(5);
  expect(run.seed).toBe(seed0);
  // the menu shows the same spot, and remembers it after a reload
  await page.evaluate(() => window.__game.goMenu());
  expect(await page.evaluate(() => window.__game.ball.s - CFG.START_S)).toBeCloseTo(r.cont, 0);
  await expect(page.locator('#modeTxt')).toContainText(String(Math.floor(r.cont)) + ' m checkpoint');
  await expect(page.locator('#btnNewTrack')).toBeVisible();
  // the reset link is plain text with a dark halo (no pill that could look like a button over the sky)
  expect(await page.evaluate(() => { const c = getComputedStyle(document.getElementById('btnNewTrack')); return [c.backgroundColor, c.textShadow !== 'none']; })).toEqual(['rgba(0, 0, 0, 0)', true]);
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
  const r = await page.evaluate(() => {
    const g = window.__game; g.contS = CFG.START_S + 1180; g.newWorld(); g.halt = true; for (let k = 0; k < 10; k++) g.tick(1 / 30, false);
    return { zone: [g.zoneIdx, zoneAt(g.ball.s)], cont: g.contS - CFG.START_S, info: document.getElementById('modeTxt').textContent, txt: fmt(g.contS - CFG.START_S) };
  });
  expect(r.zone).toEqual([2, 2]);
  // an old save between two checkpoints moves back to the checkpoint before it
  expect(r.cont).toBeGreaterThan(1000); expect(r.cont).toBeLessThanOrEqual(1180); expect(r.cont % 10).toBe(0);
  expect(r.info).toContain(r.txt);
});

test('daily run always starts from the beginning', async ({ page }) => {
  await openGame(page, '/?mode=daily');
  await fallAt(page, 320);
  await page.evaluate(() => window.__game.goMenu());
  expect(await page.evaluate(() => window.__game.ball.s - CFG.START_S)).toBeLessThan(1);
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
