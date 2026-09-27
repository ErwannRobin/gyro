import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test('procedural track stays feasible for 4 km on many seeds', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const issues = [];
    for (const seed of [1, 7, 42, 1234, 99999, 31337, dailySeed('2026-01-01'), dailySeed('2030-12-31')]) {
      const T = new Track(), G = new TrackGenerator(T, seed); G.fill(4000);
      let gapRun = 0;
      for (let i = 0; i < T.n - 2; i++) {
        const m = i & T.mask, m2 = (i + 1) & T.mask;
        if (![T.x[m], T.y[m], T.z[m], T.w[m], T.th[m]].every(Number.isFinite)) issues.push(`NaN (seed ${seed}, row ${i})`);
        if (Math.abs(T.th[m]) > 1.55) issues.push(`heading ${T.th[m].toFixed(2)} (seed ${seed}, row ${i})`);
        if (T.z[m2] <= T.z[m]) issues.push(`track turns back (seed ${seed}, row ${i})`);
        if (T.w[m] < 1.2) issues.push(`width ${T.w[m].toFixed(2)} (seed ${seed}, row ${i})`);
        const n = T.rowN[m];
        if (n === 0) { gapRun++; if (gapRun * CFG.DS > 2.6) issues.push(`gap too long (seed ${seed}, row ${i})`); continue; }
        gapRun = 0;
        let widest = 0;
        for (let k = 0; k < n; k++) widest = Math.max(widest, T.edgeB(i, k, 0.5) - T.edgeA(i, k, 0.5));
        if (widest < 0.9) issues.push(`lane ${widest.toFixed(2)} m (seed ${seed}, row ${i})`);
      }
    }
    return issues.slice(0, 12);
  });
  expect(r).toEqual([]);
});

test('daily run is the same for everyone, a new random track differs', async ({ page, browser }) => {
  await openGame(page, '/?mode=daily');
  const sample = () => { const g = window.__game; g.gen.fill(700); const m = 1200 & g.track.mask; return [g.gameMode, g.track.x[m], g.track.z[m]]; };
  const a = await page.evaluate(sample);
  expect(a[0]).toBe('daily');
  const other = await browser.newPage();
  await openGame(other, '/?mode=daily');
  expect(await other.evaluate(sample)).toEqual(a);
  const r1 = await page.evaluate(() => { const g = window.__game; g.setGameMode('random'); g.gen.fill(700); return g.track.x[1200 & g.track.mask]; });
  const r2 = await page.evaluate(() => { const g = window.__game; g.newWorld(); g.gen.fill(700); return g.track.x[1200 & g.track.mask]; });
  expect(r2).toBe(r1);                                          // random mode keeps its track until "new track"
  const r3 = await page.evaluate(() => { const g = window.__game; g.newTrack(); g.gen.fill(700); return g.track.x[1200 & g.track.mask]; });
  expect(r3).not.toBe(r1);
});
