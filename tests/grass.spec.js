import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

// Runs inside the page: a long straight flat track (no generator) and a physics world on it.
function lab() {
  const T = new Track(), N = 4000;
  for (let i = 0; i < N; i++) {
    T.x[i] = 0; T.y[i] = 0; T.z[i] = i * CFG.DS; T.th[i] = 0; T.w[i] = 3.4; T.bank[i] = 0; T.slope[i] = 0; T.kap[i] = 0;
    T.rowN[i] = 1; T.rowA[i * 3] = -1.7; T.rowB[i * 3] = 1.7; T.rowAO[i * 3] = T.rowBO[i * 3] = 1; T.rowF[i] = 0;
  }
  T.n = N;
  const ev = { n: {}, on(k) { this.n[k] = (this.n[k] || 0) + 1; }, hit() { this.on('hit'); }, land() {}, railJump() {}, boost() {}, lost() { this.on('lost'); },
    smash() { this.on('smash'); }, tuft(b, o, sp, cut) { this.on(cut ? 'cut' : 'tuft'); } };
  const P = new Physics(T, ev), b = new Ball();
  const place = (s, u, v) => { b.reset(); b.p[0] = -u; b.p[1] = CFG.R; b.p[2] = s; b.v[2] = v; b.hint = Math.floor(s / CFG.DS); };
  // steer back to the centre line (u grows toward -x here)
  const run = (sec, fwd) => { for (let k = 0; k < sec * 120; k++) { const L = T.locate(b.p[0], b.p[2], b.hint); P.step(b, Math.max(-1, Math.min(1, -L.u * 2)), fwd, 0, 1 / 120); } };
  return { T, ev, P, b, place, run };
}

test('the grass track rolls slower and is uneven', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate((labSrc) => {
    const lab = eval('(' + labSrc + ')'), grass = TRACK_THEMES.find((t) => t.pattern === 4).roll;
    const top = (roll) => { const W = lab(); W.P.roll = roll; W.place(8, 0, 0); W.run(12, 1); return { v: W.b.speed, lost: W.b.lost }; };
    const hard = top(null), soft = top(grass);
    // coasting at 10 m/s with no input: the grass ball drifts sideways, the hard deck ball does not
    const drift = (roll) => { const W = lab(); W.P.roll = roll; W.place(8, 0, 10); let m = 0;
      for (let k = 0; k < 240; k++) { W.P.step(W.b, 0, 0, 0, 1 / 120); m = Math.max(m, Math.abs(W.b.u)); } return m; };
    return { hard, soft, dHard: drift(null), dSoft: drift(grass), themes: TRACK_THEMES.length };
  }, lab.toString());
  expect(r.themes).toBe(5);
  expect(r.hard.lost).toBe(false); expect(r.soft.lost).toBe(false);
  expect(r.soft.v).toBeLessThan(r.hard.v * 0.75);
  expect(r.soft.v).toBeGreaterThan(15);
  expect(r.dHard).toBeLessThan(0.01);
  expect(r.dSoft).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});

test('grass tufts slow the ball and push it aside; star power mows them; hard decks ignore them', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate((labSrc) => {
    const lab = eval('(' + labSrc + ')'), grass = TRACK_THEMES.find((t) => t.pattern === 4).roll;
    const pass = (roll, star) => {
      const W = lab(); W.P.roll = roll; W.P.star = star;
      const o = { kind: 'tuft', s: 20, u: 0.15, id: 3, hit: -1 }; W.T.objects.push(o);
      W.place(12, 0, 9);
      let before = 0, after = 0, lat = 0;
      for (let k = 0; k < 180; k++) {
        const hit0 = o.hit; W.P.step(W.b, 0, 0, 0, 1 / 120);
        if (hit0 < 0 && o.hit >= 0) { after = Math.hypot(W.b.v[0], W.b.v[2]); lat = -W.b.v[0]; } else if (o.hit < 0) before = W.b.speed;
      }
      return { hit: o.hit >= 0, cut: !!o.cut, before, after, lat, ev: W.ev.n };
    };
    return { grass: pass(grass, false), star: pass(grass, true), hard: pass(null, false) };
  }, lab.toString());
  expect(r.grass.hit).toBe(true); expect(r.grass.ev.tuft).toBe(1);
  expect(r.grass.after).toBeLessThan(r.grass.before * 0.95);
  expect(r.grass.lat).toBeLessThan(-0.5);                        // kicked away from the tuft (it sat on the +u side)
  expect(r.star.cut).toBe(true); expect(r.star.ev.cut).toBe(1);
  expect(r.star.after).toBeGreaterThan(r.star.before * 0.97);
  expect(r.hard.hit).toBe(false);
  expect(errors).toEqual([]);
});

test('tufts sit on safe ground, the same for everyone, and never change the track', async ({ page }) => {
  const errors = await openGame(page);
  const r = await page.evaluate(() => {
    const bad = []; let count = 0;
    for (const seed of [1, 42, 777, 123456, 99999]) {
      const T = new Track(), G = new TrackGenerator(T, seed); G.fill(3000);
      const tufts = T.objects.filter((o) => o.kind === 'tuft');
      count += tufts.length;
      let last = -99;
      for (const o of tufts) {
        const i = Math.floor(o.s / CFG.DS), m = i & T.mask;
        if (T.rowN[m] !== 1 || (T.rowF[m] & (RF.BOOST | RF.CHECK | RF.START)) || o.u < T.rowA[m * 3] + 0.4 || o.u > T.rowB[m * 3] - 0.4 || o.s - last < 2.4 || o.s < CFG.START_S + 25) bad.push([seed, o.s, o.u]);
        last = o.s;
      }
      // the same seed gives the same tufts, and a track built without tufts has the same shape
      const T2 = new Track(), G2 = new TrackGenerator(T2, seed); G2.fill(3000);
      const T3 = new Track(), G3 = new TrackGenerator(T3, seed); G3.tuft = () => {}; G3.fill(3000);
      if (JSON.stringify(T2.objects.filter((o) => o.kind === 'tuft')) !== JSON.stringify(tufts)) bad.push([seed, 'differs']);
      for (let k = 0; k < T.n; k += 7) if (T.x[k] !== T3.x[k] || T.z[k] !== T3.z[k] || T.rowN[k] !== T3.rowN[k]) { bad.push([seed, 'shape', k]); break; }
      if (T.objects.filter((o) => o.kind !== 'tuft').length !== T3.objects.length) bad.push([seed, 'objects']);
    }
    return { bad, count };
  });
  expect(r.bad).toEqual([]);
  expect(r.count).toBeGreaterThan(5 * 150);
  expect(errors).toEqual([]);
});

test('choosing the grass track changes how the ball rolls; tufts show and the ball bounces over them', async ({ page }) => {
  const errors = await openGame(page);
  await page.click('#skinsMenu .skinRow:nth-child(1) .sw >> nth=4');
  expect(await page.evaluate(() => [window.__game.themeIdx, !!window.__game.physics.roll])).toEqual([4, true]);
  await page.click('#btnTilt');
  const r = await page.evaluate(() => {
    const g = window.__game, b = g.ball, T = g.track; g.halt = true;
    for (let k = 0; k < 40; k++) g.tick(1 / 30, false);
    g.gen.fill(1500);
    const o = T.objects.find((o) => o.kind === 'tuft' && o.s > b.s + 20);
    const p = [0, 0, 0, 0]; T.pointAt(o.s - 3, o.u, CFG.R, p);
    b.p[0] = p[0]; b.p[1] = p[1]; b.p[2] = p[2]; b.v[0] = Math.sin(p[3]) * 7; b.v[2] = Math.cos(p[3]) * 7; b.hint = Math.floor((o.s - 3) / CFG.DS);
    g.collapseS = o.s - 60; g.input.update = function () { this.x = 0; this.y = 0; };
    let bob = 0;
    for (let k = 0; k < 40; k++) { g.tick(1 / 60, false); bob = Math.max(bob, g.bobY); }
    return { hit: o.hit >= 0, bob, debris: g.debris.length > 0 };
  });
  expect(r).toEqual({ hit: true, bob: expect.any(Number), debris: true });
  expect(r.bob).toBeGreaterThan(0.02);
  await page.evaluate(() => window.__game.pause());
  await page.click('#skinsPause .skinRow:nth-child(1) .sw >> nth=0');
  expect(await page.evaluate(() => window.__game.physics.roll)).toBe(null);
  expect(errors).toEqual([]);
});
