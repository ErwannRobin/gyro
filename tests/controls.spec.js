import { test, expect } from '@playwright/test';
import { openGame, openOptions, teleport } from './helpers.js';

test.use({ hasTouch: true, isMobile: true });

test('tilt directions map to the ball after calibration', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const I = window.__game.input;
    const feed = (beta, gamma, n = 12) => { for (let k = 0; k < n; k++) { I.onOrient({ beta, gamma }); I.update(0.05); } return [+I.x.toFixed(2), +I.y.toFixed(2)]; };
    I.tilt = true; I.startCalibration(); feed(40, 0); I.endCalibration();
    return { neutral: feed(40, 0), right: feed(40, 15), left: feed(40, -15), forward: feed(25, 0), back: feed(55, 0) };
  });
  expect(Math.abs(r.neutral[0]) + Math.abs(r.neutral[1])).toBeLessThan(0.05);
  expect(r.right[0]).toBeGreaterThan(0.3);
  expect(r.left[0]).toBeLessThan(-0.3);
  expect(r.forward[1]).toBeGreaterThan(0.3);
  expect(r.back[1]).toBeLessThan(-0.2);
});

test('refused motion permission falls back to touch control', async ({ page }) => {
  await page.addInitScript(() => { window.DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied'); });
  await openGame(page);
  await page.tap('#btnPlay');                                        // the gyroscope is the default control on phones
  await expect(page.locator('#permMsg')).toBeVisible();
  await page.waitForFunction(() => window.__game.state !== 'menu');
  expect(await page.evaluate(() => [window.__game.mode, window.__game.input.tilt, window.__game.ctrl])).toEqual(['touch', false, 'touch']);
});

test('touch joystick steers', async ({ page }) => {
  await openGame(page);
  await openOptions(page);
  await page.tap('#ctrlSeg button[data-ctrl=touch]');
  await page.tap('#btnOpts');
  await page.tap('#btnPlay');
  await page.waitForFunction(() => window.__game.input.enabled);
  await page.mouse.move(195, 600); await page.mouse.down(); await page.mouse.move(195, 520, { steps: 4 });
  const joy = await page.evaluate(() => window.__game.input.joyY);
  await page.mouse.up();
  expect(joy).toBeGreaterThan(0.5);
});

// Pointer events on the game canvas (id: a finger).
const touch = (page, pts) => page.evaluate((pts) => {
  const cv = document.getElementById('c');
  for (const [id, x, y, type] of pts) cv.dispatchEvent(new PointerEvent(type || 'pointermove', { pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
}, pts);

test('with the gyroscope, a finger turns the camera (it swings back after), a pinch zooms, a double tap fires star power', async ({ page }) => {
  const errors = await openGame(page);
  const tick = (n) => page.evaluate((n) => { const g = window.__game; g.halt = true; for (let k = 0; k < n; k++) g.tick(1 / 60, false); }, n);
  await page.evaluate(() => { const g = window.__game, I = g.input; I.raw = [0, 0, -1]; I.lastEvt = performance.now(); I.tilt = true; g.startRun('tilt'); });
  await tick(200);
  await page.evaluate(teleport, 150);
  await page.evaluate(() => { const g = window.__game; g.input.update = function () { this.x = -g.ball.u * 0.8; this.y = 0.2; }; });   // stays on the track
  expect(await page.evaluate(() => window.__game.state)).toBe('play');
  const cam = () => page.evaluate(() => { const g = window.__game, c = g.cam, b = g.ball.p; return { yaw: c.offYaw, pitch: c.offPitch, zoom: c.zoom, d: Math.hypot(c.pos[0] - b[0], c.pos[1] - b[1], c.pos[2] - b[2]), joy: g.input.ptr }; });
  const c0 = await cam();
  await touch(page, [[1, 200, 440, 'pointerdown'], [1, 150, 470], [1, 90, 500]]);                 // left and down: around, and higher
  await tick(20);
  const c1 = await cam();
  expect(c1.yaw).toBeGreaterThan(0.6); expect(c1.pitch).toBeGreaterThan(0.2); expect(c1.joy).toBe(null);   // no joystick
  await touch(page, [[1, 90, 500, 'pointerup']]);
  await tick(20);
  expect((await cam()).yaw).toBeGreaterThan(0.6);                              // held a moment after the finger lifts…
  await tick(200);
  expect(Math.abs((await cam()).yaw)).toBeLessThan(0.05);                       // …then back behind the ball
  // pinch: fingers closing move the camera away (and the setting is kept)
  await touch(page, [[1, 120, 500, 'pointerdown'], [2, 280, 500, 'pointerdown'], [1, 160, 500], [2, 240, 500], [1, 190, 500], [2, 210, 500], [1, 190, 500, 'pointerup'], [2, 210, 500, 'pointerup']]);
  await tick(120);
  const c2 = await cam();
  expect(c2.zoom).toBeGreaterThan(1.7); expect(c2.d).toBeGreaterThan(c0.d * 1.4);
  // a double tap fires a full star gauge
  await page.evaluate(teleport, 300);
  await page.evaluate(() => { window.__game.power = 1; });
  await touch(page, [[1, 200, 500, 'pointerdown'], [1, 200, 500, 'pointerup'], [1, 200, 500, 'pointerdown'], [1, 200, 500, 'pointerup']]);
  await tick(2);
  expect(await page.evaluate(() => [window.__game.state, window.__game.star])).toEqual(['play', true]);
  await page.evaluate(() => window.__game.goMenu());
  expect(await page.evaluate(() => +JSON.parse(localStorage.getItem('gyroll.zoom')))).toBeGreaterThan(1.7);
  expect(errors).toEqual([]);
});
