import { test, expect } from '@playwright/test';
import { openGame, openOptions, play } from './helpers.js';

test.use({ viewport: { width: 360, height: 720 }, hasTouch: true, isMobile: true });

const tickN = (page, n, draw = false) => page.evaluate(([n, draw]) => { const g = window.__game; g.halt = true; for (let k = 0; k < n; k++) g.tick(1 / 60, draw); }, [n, draw]);

const still = (page) => page.addStyleTag({ content: '#menu *, #menu::before { transition: none !important; animation: none !important }' });
const vis = (page, sel) => page.evaluate((sel) => sel.map((s) => getComputedStyle(document.querySelector(s)).visibility === 'visible'), sel);
const box = (page, s) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }, s);
// A press on the menu background, as pointer events (id: a finger).
const drag = (page, pts) => page.evaluate((pts) => {
  const at = document.elementFromPoint(pts[0][1], pts[0][2]) || document.getElementById('menu');
  const ev = (type, [id, x, y]) => at.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
  for (const p of pts) ev(p[3] || 'pointermove', p);
  return at.id || at.tagName;
}, pts);

test('the light menu: title, tagline, mode switch and one PLAY in the middle; options swap PLAY for the settings', async ({ page }) => {
  const errors = await openGame(page);
  await still(page);
  const LIGHT = ['#title', '#tagline', '#modeSeg', '#modeInfo', '#btnPlay', '#btnOpts'], HIDDEN = ['#menuTop', '#sheet', '#tgKid', '#ctrlSeg', '#todSeg', '#skinsMenu', '#btnAbout'];
  expect(await vis(page, LIGHT)).toEqual(LIGHT.map(() => true));
  expect(await vis(page, HIDDEN)).toEqual(HIDDEN.map(() => false));
  expect(await page.locator('#modeSeg button').allTextContents()).toEqual(['TRAINING', 'DAILY RUN']);
  expect(await page.locator('#btnPlay').textContent()).toBe('PLAY');
  const play = await box(page, '#btnPlay');
  expect(Math.abs(play[1] + play[3] / 2 - 360)).toBeLessThan(2);            // PLAY sits in the middle of the screen: the ball shows below
  const t0 = await box(page, '#title');
  await page.click('#btnOpts');
  expect(await vis(page, ['#title', '#btnOpts', ...HIDDEN])).toEqual([true, true, ...HIDDEN.map(() => true)]);
  expect(await vis(page, ['#btnPlay', '#tagline', '#modeSeg', '#modeInfo'])).toEqual([false, false, false, false]);   // the mode switch gives its place to ABOUT
  expect(await page.locator('#btnOpts').innerText()).toBe('DONE');
  expect(await page.locator('#btnAbout').innerText()).toBe('ABOUT');
  // the title shrinks into the top bar, between the language and sound buttons; ABOUT sits below it, then the sheet
  const t1 = await box(page, '#title'), lang = await box(page, '#langSeg'), snd = await box(page, '#menu .tgMusic'), ab = await box(page, '#btnAbout'), sheet = await box(page, '#sheet');
  expect(t1[2]).toBeLessThan(t0[2] * 0.6); expect(t1[1]).toBeLessThan(t0[1]);
  expect(t1[0]).toBeGreaterThan(lang[0] + lang[2]); expect(t1[0] + t1[2]).toBeLessThan(snd[0]);
  expect(ab[1]).toBeGreaterThan(lang[1] + lang[3]); expect(Math.abs(ab[0] + ab[2] / 2 - 180)).toBeLessThan(2);
  expect(sheet[1]).toBeGreaterThan(ab[1] + ab[3] + 4);
  // DONE closes it, and so does a tap outside the sheet
  await page.click('#btnOpts');
  expect(await vis(page, LIGHT)).toEqual(LIGHT.map(() => true));
  await page.click('#btnOpts');
  expect(await drag(page, [[1, 180, 140, 'pointerdown'], [1, 180, 140, 'pointerup']])).not.toBe('sheet');
  expect(await page.evaluate(() => document.getElementById('menu').classList.contains('opts'))).toBe(false);
  // a run always comes back to the light menu
  await page.click('#btnOpts');
  await page.evaluate(() => { const g = window.__game; g.startRun('keys'); g.goMenu(); });
  expect(await page.evaluate(() => document.getElementById('menu').classList.contains('opts'))).toBe(false);
  expect(errors).toEqual([]);
});

test('the control setting picks what PLAY starts with, and is remembered', async ({ page }) => {
  await openGame(page);
  await openOptions(page);
  expect(await page.evaluate(() => window.__game.ctrl)).toBe('tilt');     // phones start with the gyroscope
  await page.click('#ctrlSeg button[data-ctrl=touch]');
  await page.click('#btnOpts');
  await play(page);
  expect(await page.evaluate(() => [window.__game.mode, window.__game.input.tilt])).toEqual(['touch', false]);
  await page.reload(); await page.waitForFunction(() => window.__game && window.__game.R);
  expect(await page.evaluate(() => [window.__game.ctrl, document.querySelector('#ctrlSeg button.on').dataset.ctrl])).toEqual(['touch', 'touch']);
});

test('on the menu a drag walks the camera around the ball, a pinch or the wheel zooms; buttons do not', async ({ page }) => {
  const errors = await openGame(page);
  await tickN(page, 30);
  const cam = () => page.evaluate(() => { const c = window.__game.cam; return { yaw: c.mYaw, zoom: c.zoomM, swing: c.swingK }; });
  const dist = () => page.evaluate(() => { const g = window.__game, e = g.cam.pos, b = g.ball.p; return Math.hypot(e[0] - b[0], e[2] - b[2]); });
  const d0 = await dist();
  expect(await drag(page, [[1, 180, 560, 'pointerdown'], [1, 120, 560], [1, 60, 560], [1, 60, 560, 'pointerup']])).toBe('menu');
  await tickN(page, 2);
  let c = await cam();
  expect(c.yaw).toBeGreaterThan(0.6); expect(c.swing).toBe(0);
  // two fingers moving apart zoom in
  await drag(page, [[1, 150, 560, 'pointerdown'], [2, 210, 560, 'pointerdown'], [1, 110, 560], [2, 250, 560], [1, 60, 560], [2, 300, 560], [1, 60, 560, 'pointerup'], [2, 300, 560, 'pointerup']]);
  await tickN(page, 90);
  c = await cam();
  expect(c.zoom).toBeLessThan(0.5);
  expect(await dist()).toBeLessThan(d0 * 0.6);
  await page.mouse.move(180, 560); await page.mouse.wheel(0, 400);
  await tickN(page, 1);
  expect((await cam()).zoom).toBeGreaterThan(c.zoom);
  // a drag that starts on a button leaves the camera alone
  const y0 = (await cam()).yaw;
  await drag(page, [[1, 180, 360, 'pointerdown'], [1, 60, 360], [1, 60, 360, 'pointerup']]);
  await tickN(page, 1);
  expect((await cam()).yaw).toBe(y0);
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
  // the mode switch and the reset link on the light menu, then the settings of the options sheet
  for (const act of ['#modeSeg button[data-mode=daily]', '#modeSeg button[data-mode=random]', '#btnNewTrack', 'options', '#tgKid', '#tgKid', '#langSeg button[data-lang=fr]', '#skinsMenu .skinRow:nth-child(2) .sw >> nth=2', '#todSeg button[data-tod=night]', '#ctrlSeg button[data-ctrl=touch]']) {
    if (act === 'options') { await openOptions(page); continue; }
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
  await openOptions(page);
  const state = () => page.evaluate(() => { const g = window.__game; return { seed: g.gen.rng && g.rSeed, s: g.ball.s, side: g.env.side.map((it) => it.x.toFixed(2)).join(), chunks: g.chunks.size, kid: g.physics.kid }; });
  const a = await state();
  await page.click('#tgKid');
  const b = await state();
  expect(b.kid).toBe(true); expect(b.s).toBe(a.s); expect(b.side).toBe(a.side); expect(b.seed).toBe(a.seed); expect(b.chunks).toBe(a.chunks);
  expect(errors).toEqual([]);
});

test('ball and track pickers show pictures drawn by the game', async ({ page }) => {
  test.slow();                                                    // 20 pictures rendered in software: slow on CI machines
  const errors = await openGame(page);
  await tickN(page, 90, true);
  const bg = () => page.evaluate(() => [...document.querySelectorAll('.sw')].map((b) => b.style.backgroundImage.slice(0, 27)));
  const all = await bg();
  expect(all.length).toBe(10);
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
