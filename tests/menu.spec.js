import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test.use({ viewport: { width: 360, height: 720 }, hasTouch: true, isMobile: true });

const tickN = (page, n, draw = false) => page.evaluate(([n, draw]) => { const g = window.__game; g.halt = true; for (let k = 0; k < n; k++) g.tick(1 / 60, draw); }, [n, draw]);

test('a tap on the menu background shows only the title and the play buttons, a second tap brings the rest back', async ({ page }) => {
  const errors = await openGame(page);
  const vis = () => page.evaluate(() => ['#title', '#tagline', '#modeSeg', '#tgKid', '#skinsMenu', '#langSeg', '#menuBest', '#btnTilt', '#btnTouch']
    .map((s) => getComputedStyle(document.querySelector(s)).visibility));
  const pos = () => page.evaluate(() => ['#title', '#btnTilt', '#btnTouch'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
  await page.addStyleTag({ content: '#menu *, #menu::before { transition: none !important }' });   // check the end state of the fades
  const p0 = await pos();
  await page.locator('#tagline').click();                        // any text or empty area counts as background
  expect(await vis()).toEqual(['visible', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'visible', 'visible']);
  // the title stays put; the play buttons slide together to the middle of the screen (the ball shows below)
  const p1 = await pos();
  expect(p1[0]).toEqual(p0[0]);
  expect(p1[1][0]).toBe(p0[1][0]); expect(p1[2][1] - p1[1][1]).toBe(p0[2][1] - p0[1][1]);
  expect(Math.abs((p1[1][1] + p1[2][1] + p1[2][3]) / 2 - 360)).toBeLessThan(2);
  expect(p1[1][1]).toBeLessThan(p0[1][1]);
  await page.mouse.click(180, 20);
  expect((await vis()).every((v) => v === 'visible')).toBe(true);
  expect(await pos()).toEqual(p0);
  // buttons never toggle it
  await page.click('#modeSeg button[data-mode=daily]');
  await page.click('#tgKid');
  expect(await page.evaluate(() => document.getElementById('menu').classList.contains('clean'))).toBe(false);
  // a run always comes back to the full menu
  await page.locator('#tagline').click();
  await page.evaluate(() => { const g = window.__game; g.startRun('keys'); g.goMenu(); });
  expect(await page.evaluate(() => document.getElementById('menu').classList.contains('clean'))).toBe(false);
  expect(errors).toEqual([]);
});

test('changing options on the menu never moves the camera', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => { const g = window.__game; g.contS = CFG.START_S + 1270; g.newWorld(); });
  await tickN(page, 120);
  const view = () => page.evaluate(() => { const g = window.__game, b = g.ball.p, e = g.cam.eye, t = g.cam.tgt, p = [0, 0, 0, 0];
    g.track.pointAt(g.ball.s + 2, 0, 0, p);                      // camera offset in the frame of the track under the ball
    const c = Math.cos(p[3]), s = Math.sin(p[3]), rel = (v) => { const x = v[0] - b[0], z = v[2] - b[2]; return [x * c - z * s, v[1] - b[1], x * s + z * c]; };
    return [...rel(e), ...rel(t)]; });
  for (const act of ['#modeSeg button[data-mode=daily]', '#tgKid', '#modeSeg button[data-mode=random]', '#btnNewTrack', '#tgKid', '#langSeg button[data-lang=fr]', '#skinsMenu .skinRow:nth-child(2) .sw >> nth=2']) {
    const a = await view();
    await page.click(act);
    await tickN(page, 1);
    const b = await view();
    expect(Math.max(...a.map((v, i) => Math.abs(v - b[i]))), act).toBeLessThan(0.08);
  }
  expect(errors).toEqual([]);
});

test('kid mode on the menu keeps the same world and only adds the rails', async ({ page }) => {
  const errors = await openGame(page);
  await tickN(page, 30);
  const state = () => page.evaluate(() => { const g = window.__game; return { seed: g.gen.rng && g.rSeed, s: g.ball.s, side: g.env.side.map((it) => it.x.toFixed(2)).join(), chunks: g.chunks.size, kid: g.physics.kid }; });
  const a = await state();
  await page.click('#tgKid');
  const b = await state();
  expect(b.kid).toBe(true); expect(b.s).toBe(a.s); expect(b.side).toBe(a.side); expect(b.seed).toBe(a.seed); expect(b.chunks).toBe(a.chunks);
  expect(errors).toEqual([]);
});

test('ball and track pickers show pictures drawn by the game', async ({ page }) => {
  const errors = await openGame(page);
  await tickN(page, 90, true);
  const bg = () => page.evaluate(() => [...document.querySelectorAll('#skinsMenu .sw, #skinsPause .sw')].map((b) => b.style.backgroundImage.slice(0, 27)));
  const all = await bg();
  expect(all.length).toBe(20);
  for (const u of all) expect(u).toBe('url("data:image/png;base64,');
  // each picture is different, and it is redrawn for a new world
  const urls = await page.evaluate(() => [...document.querySelectorAll('#skinsMenu .sw')].map((b) => b.style.backgroundImage));
  expect(new Set(urls).size).toBe(urls.length);
  await page.evaluate(() => { const g = window.__game; g.contS = CFG.START_S + 2740; g.newWorld(); });
  await tickN(page, 90, true);
  const urls2 = await page.evaluate(() => [...document.querySelectorAll('#skinsMenu .sw')].map((b) => b.style.backgroundImage));
  expect(urls2.filter((u, i) => u !== urls[i]).length).toBe(urls.length);
  expect(errors).toEqual([]);
});
