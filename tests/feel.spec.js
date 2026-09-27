import { test, expect } from '@playwright/test';
import { openGame, play } from './helpers.js';

// Game feel: hit-stop on a smash, slow motion on a near miss, the ball's squash and stretch, the speed rush.

async function startRun(page) {
  await page.addInitScript(() => localStorage.setItem('gyroll.rseed', '777'));   // a fixed track with posts
  const errors = await openGame(page);
  await play(page);
  await page.evaluate(() => { const g = window.__game; g.halt = true; for (let k = 0; k < 40; k++) g.tick(1 / 30, false); });
  return errors;
}

// Runs inside the page: rolls the ball at 12 m/s past the next post, `gap` meters clear of it
// (null: straight into it), and logs the time scale frame by frame.
function passPost([gap, star]) {
  const g = window.__game, b = g.ball, T = g.track;
  g.gen.fill(3000);
  const o = T.objects.find((o) => o.kind === 'post' && o.s > 400 && !o.broken && !o.nearDone && !o.touched);
  const s = o.s - 6, p = [0, 0, 0, 0];
  for (const ch of g.chunks.values()) g.R.free(ch.mesh);
  g.chunks.clear(); g.nextChunk = Math.max(0, Math.floor((s - 60) / (CFG.CHUNK_ROWS * CFG.DS)));
  const u = o.u + (gap === null ? 0 : (CFG.R + o.rad + gap) * (o.u > 0 ? -1 : 1));   // on the side of the track's middle
  T.pointAt(s, u, CFG.R, p);
  b.p[0] = p[0]; b.p[1] = p[1]; b.p[2] = p[2]; b.v[0] = Math.sin(p[3]) * 12; b.v[1] = 0; b.v[2] = Math.cos(p[3]) * 12;
  b.hint = Math.floor(s / CFG.DS); b.lost = false; b.grounded = true;
  const L = T.locate(b.p[0], b.p[2], b.hint); b.s = L.s; b.surfY = p[1] - CFG.R;
  g.maxS = b.s; g.collapseS = b.s - 45; g.runT = 10; g.state = 'play';
  g.updateChunks(99); g.cam.snap(b, T, g.R.w / g.R.h); g.cam.mode = 'follow';
  g.input.update = function () { this.x = 0; this.y = 0; };
  g.nearCool = 0; g.tw.t = 9; g.nears = 0;
  if (star) { g.power = 1; g.tryStar(); } else g.endStar(true);
  const sc = g.score, scale = [], slow = []; let rings = 0;
  for (let k = 0; k < 90 && g.state === 'play'; k++) { g.tick(1 / 60, false); scale.push(g.timeScale); slow.push(g.slowK); rings = Math.max(rings, g.rings.length); }
  return { near: g.nears, touched: !!o.touched, broken: !!o.broken, passed: b.s > o.s + 2, scale, slow, rings, bonus: g.score - sc, cam: g.cam.focus };
}

test('a post passed close at speed: bonus points and a moment of slow motion; a wide pass or a hit: nothing', async ({ page }) => {
  const errors = await startRun(page);
  const close = await page.evaluate(passPost, [0.15, false]);
  expect(close.near).toBe(1); expect(close.touched).toBe(false); expect(close.passed).toBe(true);
  expect(close.bonus).toBeGreaterThanOrEqual(200);
  const slowFrames = close.scale.filter((k) => k < 0.35).length;
  expect(slowFrames).toBeGreaterThan(20); expect(slowFrames).toBeLessThan(40);       // about 0.4 s of real time
  expect(close.scale[close.scale.length - 1]).toBe(1);                              // then time comes back
  expect(Math.max(...close.slow)).toBeGreaterThan(0.9); expect(close.rings).toBeGreaterThan(0);
  const wide = await page.evaluate(passPost, [1.0, false]);
  expect(wide.near).toBe(0); expect(Math.min(...wide.scale)).toBe(1);
  const hit = await page.evaluate(passPost, [null, false]);
  expect(hit.touched).toBe(true); expect(hit.near).toBe(0);
  expect(errors).toEqual([]);
});

test('star power smash: the world almost freezes for a blink, with a shockwave, then time rushes back', async ({ page }) => {
  const errors = await startRun(page);
  const r = await page.evaluate(passPost, [null, true]);
  expect(r.broken).toBe(true); expect(r.near).toBe(0); expect(r.passed).toBe(true);
  const i = r.scale.findIndex((k) => k < 0.1), frozen = r.scale.filter((k) => k < 0.1).length;
  expect(i).toBeGreaterThan(0); expect(frozen).toBeGreaterThanOrEqual(3); expect(frozen).toBeLessThanOrEqual(6);   // about 75 ms
  expect(r.scale[i + 15]).toBe(1);
  expect(r.rings).toBeGreaterThan(0); expect(Math.max(...r.slow)).toBe(0);               // a freeze, not the slow motion look
  expect(errors).toEqual([]);
});

test('the ball squashes when it lands, stretches as it falls, and springs back', async ({ page }) => {
  const errors = await startRun(page);
  const r = await page.evaluate(() => {
    const g = window.__game, b = g.ball;
    b.p[1] = b.surfY + CFG.R + 3; b.v[1] = 0; b.grounded = false; b.air = 0; b.v[0] *= 0.2; b.v[2] *= 0.2;
    let lo = 0, hi = 0, landed = -1;
    for (let k = 0; k < 150; k++) {
      g.tick(1 / 60, false);
      if (!b.grounded) hi = Math.max(hi, g.sq);
      if (landed < 0 && g.sq < -0.05) landed = k;
      lo = Math.min(lo, g.sq);
    }
    // the drawn ball: flatter than it is wide, its bottom still on the deck
    g.sq = -0.2; const m = new Float32Array(16); M4.fromTRS(m, b.p[0], b.p[1], b.p[2], b.q, CFG.R, CFG.R, CFG.R);
    const c = g.squash(m, b.p, [0, 1, 0]), h = Math.hypot(m[1], m[5], m[9]), w = Math.hypot(m[0], m[4], m[8]);
    return { lo, hi, landed, h, w, sink: b.p[1] - c[1] };
  });
  expect(r.hi).toBeGreaterThan(0.06);          // stretched while falling
  expect(r.lo).toBeLessThan(-0.12);            // squashed on landing
  expect(r.landed).toBeGreaterThan(0);
  expect(r.h).toBeLessThan(r.w);
  expect(r.sink).toBeCloseTo(0.2 * 0.42, 3);
  // and it settles back to round
  const end = await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 90; k++) g.tick(1 / 60, false); return Math.abs(g.sq); });
  expect(end).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});

test('speed rush past 70 km/h: stronger speed lines, wind and dark edges; no camera rumble with reduced motion', async ({ page }) => {
  const errors = await startRun(page);
  const rush = (reduced) => page.evaluate((reduced) => {
    const g = window.__game, b = g.ball, T = g.track; g.still = reduced;
    g.physics.kid = true;
    g.input.update = function () { const L = T.locate(b.p[0], b.p[2], b.hint); this.x = Math.max(-1, Math.min(1, L.u * 2)); this.y = 1; };
    const out = {};
    for (let k = 0; k < 60 && g.state === 'play'; k++) { if (b.grounded) { const f = 12 / Math.max(b.speed, 1); b.v[0] *= f; b.v[2] *= f; } g.tick(1 / 60, false); }
    out.slowRush = g.rushK;
    for (let k = 0; k < 90 && g.state === 'play'; k++) { if (b.grounded) { const f = 32 / Math.max(b.speed, 1); b.v[0] *= f; b.v[2] *= f; } g.tick(1 / 60, false); }
    out.fastRush = g.rushK; out.camRush = g.cam.rush; out.state = g.state;
    return out;
  }, reduced);
  const a = await rush(false);
  expect(a.state).toBe('play');
  expect(a.slowRush).toBeLessThan(0.05); expect(a.fastRush).toBeGreaterThan(0.6); expect(a.camRush).toBeGreaterThan(0.6);
  const b = await rush(true);
  expect(b.fastRush).toBeGreaterThan(0.6); expect(b.camRush).toBe(0);
  // one frame drawn at full rush: no errors from the new shader uniforms and the ring pass
  await page.evaluate(() => { const g = window.__game; g.rings.push({ p: g.ball.p.slice(), t: 0, dur: 0.5, size: 2, col: [1, 1, 1], a: 1, n: [0, 1, 0] }); g.slowK = 0.8; g.tick(1 / 60, true); });
  expect(errors).toEqual([]);
});
