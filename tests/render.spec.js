import { test, expect } from '@playwright/test';
import { openGame, teleport } from './helpers.js';

test('all five worlds render without WebGL errors and with few draw calls', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => { const g = window.__game; g.halt = true; for (let i = 0; i < ZONES.length; i++) g.R.ensureZone(i); g.startRun('keys'); });
  for (const d of [120, 640, 1140, 1640, 2140]) {
    await page.evaluate(teleport, d);
    const r = await page.evaluate(() => {
      const g = window.__game, gl = g.R.gl; let calls = 0;
      const wrap = (o, k) => { const f = o[k].bind(o); o[k] = (...a) => { calls++; return f(...a); }; return () => { o[k] = f; }; };
      for (let k = 0; k < 20; k++) g.tick(1 / 60, false);
      const undo = [wrap(gl, 'drawElements'), wrap(gl, 'drawArrays')];
      if (g.R.inst) undo.push(wrap(g.R.inst, 'drawElementsInstancedANGLE'));
      g.render();
      undo.forEach((u) => u());
      return { err: gl.getError(), calls, zone: g.zoneIdx, inst: !!g.R.inst };
    });
    expect(r.err).toBe(0);
    expect(r.zone).toBe(Math.floor(d / 500));
    if (r.inst) expect(r.calls).toBeLessThan(60);
  }
  expect(errors).toEqual([]);
});

test('share builds a video (or an image) of the run', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(async () => {
    const g = window.__game, R = g.replay;
    for (let k = 0; k < 10; k++) { g.tick(1 / 30, true); R.capture(g.canvas, 1, 10 * k, false); await new Promise((res) => setTimeout(res, 80)); }
    const f = await R.make({ dist: 123, score: 4567, best: 200, record: true, recordTxt: 'NEW RECORD', tag: '', accent: '#4ef2ff', accent2: '#ff4fd8', portrait: true }, () => {});
    return f && { type: f.type, size: f.size, name: f.name };
  });
  expect(r).not.toBeNull();
  expect(r.type).toMatch(/^(video\/(mp4|webm)|image\/png)$/);
  expect(r.size).toBeGreaterThan(10000);
});
