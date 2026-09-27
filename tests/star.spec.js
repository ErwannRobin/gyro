import { test, expect } from '@playwright/test';
import { openGame, teleport, openOptions, play } from './helpers.js';

// Starts a keyboard run and skips the countdown.
async function startRun(page) {
  await play(page);
  await page.evaluate(() => { const g = window.__game; g.halt = true; for (let k = 0; k < 40; k++) g.tick(1 / 30, false); });
}

test('coins: a streak raises the multiplier, a miss resets it, the gauge fills', async ({ page }) => {
  const errors = await openGame(page);
  await startRun(page);
  const r = await page.evaluate(() => {
    const g = window.__game, out = {};
    const coin = () => g.coin({ kind: 'gem' });
    for (let k = 0; k < 4; k++) coin();
    out.after4 = g.coinMult;
    for (let k = 0; k < 4; k++) coin();
    out.after8 = g.coinMult; out.power8 = g.power;
    g.coinMissed({ kind: 'gem' });
    out.afterMiss = [g.coinMult, g.coinStreak];
    const s0 = g.score; coin(); out.coinPts = g.score - s0;
    g.tick(1 / 60, false);
    out.ready = document.getElementById('power').classList.contains('ready');
    return out;
  });
  expect(r.after4).toBe(2);
  expect(r.after8).toBe(3);
  expect(r.power8).toBeGreaterThan(0.9);
  expect(r.afterMiss).toEqual([1, 0]);
  expect(r.coinPts).toBe(250);
  expect(r.ready).toBe(true);
  expect(errors).toEqual([]);
});

test('a coin left behind on the track breaks the streak', async ({ page }) => {
  await openGame(page);
  await startRun(page);
  await page.evaluate(teleport, 100);
  const r = await page.evaluate(() => {
    const g = window.__game, b = g.ball;
    g.coinStreak = 7; g.coinMult = 2;
    g.track.objects.push({ kind: 'gem', s: b.s - 3, u: 2, h: 0.55, id: 999, taken: false });
    g.progress(1 / 60);
    return [g.coinStreak, g.coinMult];
  });
  expect(r).toEqual([0, 1]);
});

test('a quick tilt up triggers the flick, also with the phone held upright', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const I = window.__game.input, out = [];
    const flick = (from, to) => {
      I.flick = false; I.lastFlick = -1e9; I.hist.length = 0;
      for (let k = 0; k < 4; k++) I.onOrient({ beta: from, gamma: 0 });
      I.onOrient({ beta: (from + to) / 2, gamma: 0 }); I.onOrient({ beta: to, gamma: 0 });
      return I.flick;
    };
    out.push(flick(40, 68), flick(70, 98), flick(40, 50), flick(60, 30));
    return out;
  });
  expect(r).toEqual([true, true, false, false]);
});

test('star power: rails on, music faster, then the gauge drains and rails go away', async ({ page }) => {
  const errors = await openGame(page);
  await startRun(page);
  const r = await page.evaluate(() => {
    const g = window.__game, out = {};
    g.power = 1; g.input.flick = true; g.tick(1 / 60, false);
    out.on = [g.star, g.physics.star, g.audio.tempo, document.body.classList.contains('star')];
    // full sideways steering: the star rails keep the ball on the track
    g.input.update = function () { this.x = 1; this.y = 0.15; };
    let minMargin = 9;
    for (let k = 0; k < 150 && g.state === 'play'; k++) {
      g.tick(1 / 60, false);
      const L = g.track.locate(g.ball.p[0], g.ball.p[2], g.ball.hint);
      minMargin = Math.min(minMargin, L.w / 2 - Math.abs(L.u));
    }
    out.lost = g.ball.lost; out.minMargin = minMargin;
    g.input.update = function () { this.x = 0; this.y = 0; };
    const s0 = g.score; g.maxS = g.ball.s - 1; g.progress(1 / 60); out.doubled = g.score - s0;
    for (let k = 0; k < 60 * 7 && g.star; k++) g.tick(1 / 60, false);
    out.off = [g.star, g.physics.star, g.audio.tempo, g.power, document.body.classList.contains('star')];
    return out;
  });
  expect(r.on).toEqual([true, true, 1.3, true]);
  expect(r.lost).toBe(false);
  expect(r.minMargin).toBeGreaterThan(0.2);
  expect(r.doubled).toBeGreaterThanOrEqual(20);
  expect(r.off).toEqual([false, false, 1, 0, false]);
  expect(errors).toEqual([]);
});

test('star power cannot start before the gauge is full; Space and a tap on the gauge start it', async ({ page }) => {
  await openGame(page);
  await startRun(page);
  expect(await page.evaluate(() => { const g = window.__game; g.power = 0.8; g.input.flick = true; g.tick(1 / 60, false); return g.star; })).toBe(false);
  await page.evaluate(() => { const g = window.__game; g.power = 1; g.tick(1 / 60, false); });
  await page.keyboard.press(' ');
  expect(await page.evaluate(() => { const g = window.__game; g.tick(1 / 60, false); return g.star; })).toBe(true);
  await page.evaluate(() => { const g = window.__game; g.endStar(true); g.power = 1; g.tick(1 / 60, false); });
  await page.click('#power');
  expect(await page.evaluate(() => window.__game.star)).toBe(true);
  // falling ends star power and its screen glow
  await page.evaluate(() => { const g = window.__game; g.lost(g.ball, 'fall'); });
  expect(await page.evaluate(() => [window.__game.star, window.__game.physics.star, document.body.classList.contains('star')])).toEqual([false, false, false]);
});

test('safety rails give way to a hard side hit', async ({ page }) => {
  await openGame(page);
  await openOptions(page);
  await page.click('#tgKid');
  await startRun(page);
  const hit = async (speed) => {
    await page.evaluate(teleport, 120);
    return page.evaluate((speed) => {
      const g = window.__game, b = g.ball, T = g.track;
      // put the ball near the right edge of a plain row, rolling straight at it
      for (let s = b.s; s < b.s + 150; s += 0.5) {
        const m = Math.floor(s / CFG.DS) & T.mask;
        if (T.rowN[m] === 1 && T.rowAO[m * 3] && T.rowBO[m * 3] && !(T.rowF[m] & 3)) {
          const p = [0, 0, 0, 0]; T.pointAt(s, T.w[m] / 2 - 1.1, CFG.R, p);
          b.p[0] = p[0]; b.p[1] = p[1]; b.p[2] = p[2];
          const rx = -Math.cos(p[3]), rz = Math.sin(p[3]);
          b.v[0] = rx * speed + Math.sin(p[3]) * 4; b.v[1] = 0; b.v[2] = rz * speed + Math.cos(p[3]) * 4;
          b.hint = Math.floor(s / CFG.DS); b.grounded = true; b.hop = 0; g.collapseS = s - 45;
          break;
        }
      }
      g.input.update = function () { this.x = 0; this.y = 0; };
      for (let k = 0; k < 120 && g.state === 'play'; k++) g.tick(1 / 60, false);
      return g.state === 'play' && !b.lost;
    }, speed);
  };
  expect(await hit(4)).toBe(true);
  expect(await hit(7.5)).toBe(true);                            // kid rails are higher: they hold more than star power rails
  expect(await hit(11)).toBe(false);
});

test('star power smashes the obstacles it touches; without it they stop the ball', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gyroll.rseed', '777'));   // a fixed track: some posts sit on slopes
  const errors = await openGame(page);
  await startRun(page);
  const run = (star) => page.evaluate(([star, tp]) => {
    const g = window.__game, b = g.ball, T = g.track;
    g.gen.fill(3000);
    const o = T.objects.find((o) => o.kind === 'post' && o.s > 400 && !o.broken);
    eval('(' + tp + ')')(o.s - CFG.START_S - 8);
    const p = [0, 0, 0, 0]; T.pointAt(o.s - 5, o.u, CFG.R, p);
    b.p[0] = p[0]; b.p[1] = p[1]; b.p[2] = p[2]; b.v[0] = Math.sin(p[3]) * 12; b.v[2] = Math.cos(p[3]) * 12; b.hint = Math.floor((o.s - 5) / CFG.DS);
    g.input.update = function () { this.x = 0; this.y = 0; };
    if (star) { g.power = 1; g.tryStar(); } else g.endStar(true);
    const sc = g.score; let v1 = 0;
    for (let k = 0; k < 60 && g.state === 'play'; k++) { g.tick(1 / 60, false); if (!v1 && (o.broken || b.s > o.s - 0.8)) v1 = b.speed; }
    return { broken: !!o.broken, debris: g.debris.length, passed: b.s > o.s + 2, v1, bonus: g.score - sc, state: g.state };
  }, [star, teleport.toString()]);
  const a = await run(true);
  expect(a.broken).toBe(true); expect(a.debris).toBeGreaterThan(8); expect(a.passed).toBe(true); expect(a.v1).toBeGreaterThan(10);
  expect(a.bonus).toBeGreaterThanOrEqual(1000);
  const b = await run(false);
  expect(b.broken).toBe(false); expect(b.passed).toBe(false);
  expect(errors).toEqual([]);
});

test('speed keeps growing past 50 km/h with full forward tilt', async ({ page }) => {
  await openGame(page);
  await openOptions(page);
  await page.click('#tgKid');
  await startRun(page);
  const v = await page.evaluate(() => {
    const g = window.__game, b = g.ball, T = g.track;
    g.newWorld(777); g.state = 'play';                          // fixed track
    // autopilot: full forward, steer back to the centre line
    g.input.update = function () { const L = T.locate(b.p[0], b.p[2], b.hint); this.x = Math.max(-1, Math.min(1, L.u * 1.5)); this.y = 1; };
    let top = 0;
    for (let k = 0; k < 60 * 8 && g.state === 'play'; k++) { g.tick(1 / 60, false); top = Math.max(top, b.speed); }
    return top * 3.6;
  });
  expect(v).toBeGreaterThan(65);
});

test('scenery never enters the track corridor nor hides the ball', async ({ page }) => {
  await openGame(page);
  await startRun(page);
  let bad = 0, count = 0;
  for (let z = 0; z < 9; z++) {                                  // every world
    await page.evaluate(teleport, 60 + z * 500);
    const r = await page.evaluate(() => {
      const g = window.__game, b = g.ball, T = g.track, E = g.env;
      let n = 0, seen = 0;
      g.physics.kid = true;                                     // keep the ball on the track so the camera can travel
      g.input.update = function () { const L = T.locate(b.p[0], b.p[2], b.hint); this.x = Math.max(-1, Math.min(1, L.u * 1.5)); this.y = 0.4; };
      for (let k = 0; k < 60 * 5 && g.state === 'play'; k++) {
        g.tick(1 / 60, false);
        const e = g.cam.eye, i0 = Math.floor((b.s - 40) / CFG.DS);
        const all = [...E.side, ...E.mid, ...E.heroes.flatMap((h) => h.items)];
        seen = Math.max(seen, all.length);
        for (const it of all) {
          if (it.dying || it.occ === 'ring' || it.occ === 'plane') continue;   // arches the track runs through
          if (Environment.near(T, it, i0, T.n - 1, 0.5)) n++;                  // inside the keep-out zone
          const inside = Math.hypot(e[0] - it.x, e[2] - it.z) < it.hr && e[1] > it.y - it.down && e[1] < it.y + it.up;
          if (inside && !Environment.occludes(it, e, b.p, g.time)) n++;        // camera inside a drawn object
        }
      }
      return { n, seen };
    });
    bad += r.n; count = Math.min(count || 1e9, r.seen);
  }
  expect(bad).toBe(0);
  expect(count).toBeGreaterThan(15);                            // the worlds are still furnished
});

test('a giant object that ends up on the track is hidden and removed', async ({ page }) => {
  await openGame(page);
  await startRun(page);
  await page.evaluate(teleport, 1100);
  const r = await page.evaluate(() => {
    const g = window.__game, E = g.env, b = g.ball, p = [0, 0, 0, 0];
    g.track.pointAt(b.s + 30, 0, 0, p);
    const h = { z: zoneAt(b.s), s: b.s, items: [] }; E.heroes.push(h);
    const T = E.T; E.T = null;                                  // skip the keep-out check to force it there
    E.item(h.items, b.s, g.R.meshes.sphere, p[0], p[1], p[2], 42, 42, 42, [1, 1, 1], { fogK: 0.5 });
    E.T = T;
    const it = h.items[0], hiddenInside = Environment.occludes(it, [p[0], p[1] + 3, p[2]], b.p, 0);
    g.input.update = function () { this.x = 0; this.y = 0; };
    for (let k = 0; k < 60; k++) g.tick(1 / 60, false);
    return { hiddenInside, gone: !h.items.includes(it) || it.dying > 0 };
  });
  expect(r).toEqual({ hiddenInside: true, gone: true });
});
