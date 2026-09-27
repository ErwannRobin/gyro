import { test, expect } from '@playwright/test';
import { openGame, openOptions } from './helpers.js';

test.use({ timezoneId: 'Europe/Paris', hasTouch: true, isMobile: true });

test('time of day: the real clock moves the sun across the front of the view; a moon rises at night', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const at = (h, m = 0, mo = 5, d = 21) => skyState('real', new Date(2026, mo, d, h, m));
    const S = { morning: at(9), noon: at(13, 30), evening: at(18), night: at(23, 30), winter: at(13, 30, 11) };
    const out = {};
    for (const k in S) out[k] = { moon: S[k].moon, night: S[k].night, x: S[k].dir[0], y: S[k].dir[1], z: S[k].dir[2] };
    const fixed = (m, dark) => { const s = skyState(m, new Date(2026, 5, 21, 13), dark); return [s.moon, s.night, s.dir]; };
    out.modes = { day: fixed('day'), night: fixed('night'), dark: fixed('system', true), light: fixed('system', false) };
    // over a month the moon goes from a thin crescent to full, lit on the right while it grows
    const ph = []; for (let d = 0; d < 30; d++) { const s = skyState('night', new Date(2026, 0, 1 + d, 22)); ph.push([s.phase, s.side]); }
    out.phase = { min: Math.min(...ph.map((p) => p[0])), max: Math.max(...ph.map((p) => p[0])), sides: [...new Set(ph.map((p) => p[1]))].sort() };
    return out;
  });
  expect(r.morning.moon).toBe(false); expect(r.morning.x).toBeGreaterThan(0.3);        // rises on the left (east)
  expect(r.evening.x).toBeLessThan(-0.3);                                               // sets on the right
  expect(r.noon.z).toBeGreaterThan(0.7); expect(Math.abs(r.noon.x)).toBeLessThan(0.35);   // ahead at noon…
  expect(r.noon.y).toBeGreaterThan(r.morning.y); expect(r.noon.y).toBeGreaterThan(r.evening.y);
  expect(r.winter.y).toBeLessThan(r.noon.y - 0.2);                                      // …and lower in winter
  expect(r.night.moon).toBe(true); expect(r.night.night).toBe(1); expect(r.night.y).toBeGreaterThan(0.15);
  expect(r.modes).toEqual({ day: [false, 0, null], night: [true, 1, null], dark: [true, 1, null], light: [false, 0, null] });
  expect(r.phase.min).toBeLessThan(0.25); expect(r.phase.max).toBe(2.4); expect(r.phase.sides).toEqual([-1, 1]);
});

test('night dims bright worlds and swaps sunlight for moonlight; dark worlds barely change', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, N = skyState('night'), D = skyState('day');
    return ZONES.map((z) => ({ id: z.id, fog: lum(skyZone(z, N).fog) / lum(skyZone(z, D).fog), sun: lum(skyZone(z, N).sun) / lum(z.sun), blue: skyZone(z, N).sun[2] >= skyZone(z, N).sun[0] }));
  });
  const by = Object.fromEntries(r.map((z) => [z.id, z]));
  for (const id of ['farm', 'sea', 'desert', 'forest', 'abstract']) { expect(by[id].fog, id).toBeLessThan(0.35); expect(by[id].sun, id).toBeLessThan(0.7); }
  for (const id of ['tech', 'neon', 'chaos']) expect(by[id].fog, id).toBeGreaterThan(0.85);
  for (const z of r) if (z.id !== 'chaos') expect(z.blue, z.id).toBe(true);           // the red world keeps a red light
});

test('the setting repaints the sky, is remembered and follows the dark mode of the device', async ({ page }) => {
  const errors = await openGame(page);
  await openOptions(page);
  const sky = () => page.evaluate(() => { const g = window.__game; return [g.tod, g.R.sky.moon, g.R.zoneTex.filter(Boolean).length]; });
  expect(await sky()).toEqual(['day', false, expect.any(Number)]);
  await page.click('#todSeg button[data-tod=night]');
  expect((await sky()).slice(0, 2)).toEqual(['night', true]);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('#todSeg button[data-tod=system]');
  expect((await sky()).slice(0, 2)).toEqual(['system', true]);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => window.__game.R.sky.moon === false);
  await page.reload(); await page.waitForFunction(() => window.__game && window.__game.R);
  expect((await sky()).slice(0, 2)).toEqual(['system', false]);
  expect(errors).toEqual([]);
});

// Looks straight at the sun (or the moon) with the sky shader alone: a bright disc in the middle.
test('the sun and the moon are drawn in the sky, and every world renders at night', async ({ page }) => {
  const errors = await openGame(page);
  const look = () => page.evaluate(() => {
    const g = window.__game, R = g.R, gl = R.gl, W = 64; g.halt = true;
    const d = R.sunDir, eye = [0, 5, 0];
    R.setCamera(eye, [d[0] * 10, 5 + d[1] * 10, d[2] * 10], 0, 0.5, 0.1, 1000, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, W);
    R.drawSky(1, false);
    const px = new Uint8Array(W * W * 4); gl.readPixels(0, 0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const at = (x, y) => { const i = (y * W + x) * 4; return px[i] + px[i + 1] + px[i + 2]; };
    return { mid: at(32, 32), off: Math.max(at(32, 2), at(2, 32), at(61, 32)), err: gl.getError() };
  });
  const day = await look();
  expect(day.err).toBe(0); expect(day.mid).toBeGreaterThan(700); expect(day.mid).toBeGreaterThan(day.off + 60);
  await page.evaluate(() => window.__game.setTod('night'));
  const night = await look();
  expect(night.err).toBe(0); expect(night.mid).toBeGreaterThan(night.off + 150);
  const r = await page.evaluate(() => {
    const g = window.__game, gl = g.R.gl, out = [];
    for (let i = 0; i < ZONES.length; i++) g.R.ensureZone(i);
    g.startRun('keys');
    for (let z = 0; z < ZONES.length; z++) {
      g.maxS = CFG.START_S + z * 500 + 100; g.updateZones(0.1); g.render();
      out.push([g.zoneIdx, gl.getError()]);
    }
    return out;
  });
  expect(r).toEqual(Array.from({ length: 9 }, (_, i) => [i, 0]));
  expect(errors).toEqual([]);
});
