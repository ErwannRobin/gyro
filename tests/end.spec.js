import { test, expect } from '@playwright/test';
import { openGame, teleport } from './helpers.js';

// A keyboard run at `dist` meters (the track already collapsing behind), then the ball pushed off the side.
async function pushOff(page, dist) {
  await page.evaluate(() => { const g = window.__game; g.halt = true; g.startRun('keys'); g.ui.hideNow('menu'); for (let k = 0; k < 40; k++) g.tick(1 / 30, false); });
  await page.evaluate(teleport, dist);
  await page.evaluate(() => {
    const g = window.__game, b = g.ball, L = g.track.locate(b.p[0], b.p[2], b.hint);
    g.vc = 4; g.runT = 10;
    b.p[0] += L.rx * (L.w / 2 + 1.5); b.p[2] += L.rz * (L.w / 2 + 1.5);
    for (let k = 0; k < 120 && g.state === 'play'; k++) g.tick(1 / 60, false);
  });
}
const snap = (page) => page.evaluate(() => {
  const g = window.__game, b = g.ball;
  return { state: g.state, frozen: !!g.frozen, cS: g.collapseS, ph: g.physics.time, time: g.time, y: b.p[1], above: b.p[1] - CFG.R - g.floorY, p: b.p.slice(), cam: g.cam.pos.slice() };
});

test('after a fall the world goes on (the track keeps collapsing) and stops just above the landscape: the end frame', async ({ page }) => {
  const errors = await openGame(page);
  await pushOff(page, 150);
  const a = await snap(page);
  expect(a.state).toBe('falling');
  // the game over screen comes up while the ball is still well above the ground; the collapse went on
  const b = await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 400 && g.state !== 'over'; k++) g.tick(1 / 60, false); return null; }).then(() => snap(page));
  expect(b.state).toBe('over'); expect(b.frozen).toBe(false);
  expect(b.cS).toBeGreaterThan(a.cS + 2); expect(b.ph).toBeGreaterThan(a.ph + 0.5);
  expect(b.above).toBeGreaterThan(15);
  // it keeps falling (pictures still go to the replay) until just above the landscape, then everything stops
  const n0 = await page.evaluate(() => window.__game.replay.all().length);
  await page.evaluate(async () => {
    const g = window.__game;
    for (let k = 0; k < 400 && !g.frozen; k++) g.tick(1 / 60, true);
    while (g.replay.pending) await new Promise((r) => setTimeout(r, 10));
  });
  const c = await snap(page);
  expect(c.frozen).toBe(true);
  expect(c.cS).toBeGreaterThan(b.cS + 1);
  expect(c.above).toBeGreaterThan(7); expect(c.above).toBeLessThanOrEqual(9.01);
  const fr = await page.evaluate(() => window.__game.replay.all());
  expect(fr.length).toBeGreaterThan(n0); expect(fr[fr.length - 1].fall).toBe(true);
  await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 150; k++) g.tick(1 / 60, false); });
  const d = await snap(page);
  expect([d.cS, d.ph, d.time, d.p]).toEqual([c.cS, c.ph, c.time, c.p]);
  // the camera settles a few meters from the ball, a little above it
  const dist = Math.hypot(d.cam[0] - d.p[0], d.cam[1] - d.p[1], d.cam[2] - d.p[2]);
  expect(dist).toBeGreaterThan(5.5); expect(dist).toBeLessThan(8);
  expect(d.cam[1] - d.p[1]).toBeGreaterThan(0.8);
  // a new run starts the world again
  await page.evaluate(() => { const g = window.__game; g.startRun('keys'); for (let k = 0; k < 10; k++) g.tick(1 / 60, false); });
  expect(await page.evaluate(() => window.__game.frozen)).toBe(false);
  expect(errors).toEqual([]);
});

test('on the game over screen, turning the phone walks the camera around the ball; SHARE stops the world at once', async ({ page }) => {
  const errors = await openGame(page);
  await pushOff(page, 150);
  await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 400 && g.state !== 'over'; k++) g.tick(1 / 60, false); });
  // SHARE: the world stops while the popup is open
  expect(await page.evaluate(() => window.__game.frozen)).toBe(false);
  await page.click('#btnShare');
  const s0 = await snap(page);
  await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 30; k++) g.tick(1 / 60, false); });
  const s1 = await snap(page);
  expect(s1.frozen).toBe(true); expect([s1.p, s1.cS]).toEqual([s0.p, s0.cS]);
  await page.click('#btnShClose');
  // the phone: the pose at game over is the reference; turning it swings the camera around the ball, tilting it raises it
  const look = (heading, pitch, n) => page.evaluate(([h, p, n]) => {
    const g = window.__game, I = g.input, b = g.ball.p;
    for (let k = 0; k < n; k++) { I.raw = [0, 0, -1]; I.lastEvt = performance.now(); I.heading = h; I.pitch = p; g.tick(1 / 60, false); }
    const c = g.cam.pos, dx = c[0] - b[0], dz = c[2] - b[2];
    return { a: Math.atan2(dx, dz), e: Math.atan2(c[1] - b[1], Math.hypot(dx, dz)) };
  }, [heading, pitch, n]);
  const r0 = await look(0.2, 0.1, 150);
  const r1 = await look(0.2 + 0.8, 0.1, 90);
  let da = r1.a - r0.a; da = Math.atan2(Math.sin(da), Math.cos(da));
  expect(da).toBeLessThan(-0.65); expect(da).toBeGreaterThan(-0.95);
  const r2 = await look(0.2 + 0.8, 0.1 - 0.3, 90);
  expect(r2.e - r1.e).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});
